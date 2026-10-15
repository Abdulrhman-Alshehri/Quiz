// A small stand-in for Supabase's Data API (PostgREST), for running the site
// and every test against a local PostgreSQL instead of the live project.
//
//   node tools/local-backend/server.mjs        (PORT=54321, DATABASE_URL=postgres://postgres@localhost:54322/quiz)
//
// What it covers: POST /rest/v1/rpc/<function> with named arguments, run as the
// "anon" role inside one transaction per request (as PostgREST does), with the
// same error shape ({ code, message, details, hint }); plain table requests
// (GET/POST/PATCH/DELETE /rest/v1/<table>) so the access-control tests can
// confirm that the public key cannot read or write tables directly.
// What it does not cover: Realtime. WebSocket upgrades are refused, so the app
// falls back to polling, exactly as it does when Realtime is down in production.
import http from 'node:http';
import pg from 'pg';

const PORT = Number(process.env.PORT || 54321);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@localhost:54322/quiz';
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 40 });

const IDENT = /^[a-z_][a-z0-9_]*$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, accept, accept-profile, content-profile, range',
  'Access-Control-Expose-Headers': 'content-range',
  'Access-Control-Max-Age': '600',
};

// Looked up on every call, so a migration applied while the server runs is picked up at once.
async function functions() {
  const { rows } = await pool.query(`
    select p.proname as name, p.pronargs as nargs, p.pronargdefaults as ndefaults,
           coalesce(p.proargnames, '{}') as argnames,
           array(select format_type(t, null) from unnest(p.proargtypes) t) as argtypes,
           format_type(p.prorettype, null) as rettype, p.proretset as retset
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'`);
  const catalog = new Map();
  for (const r of rows) {
    const list = catalog.get(r.name) || [];
    list.push({ ...r, argnames: r.argnames.slice(0, r.nargs) });
    catalog.set(r.name, list);
  }
  return catalog;
}

function pickOverload(candidates, keys) {
  const fits = candidates.filter((f) => {
    if (!keys.every((k) => f.argnames.includes(k))) return false;
    return f.argnames.every((a, i) => keys.includes(a) || i >= f.nargs - f.ndefaults);
  });
  return fits.length === 1 ? fits[0] : fits.length > 1 ? 'ambiguous' : null;
}

function toParam(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  if (type.endsWith('[]')) return Array.isArray(value) ? value : value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function send(res, status, body, extra = {}) {
  const headers = { ...CORS, ...extra };
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

function pgError(e) {
  const body = { code: e.code || 'PGRST000', details: e.detail || null, hint: e.hint || null, message: e.message };
  let status = 400;
  if (e.code === '42501') status = 401; // permission denied for the anon role (PostgREST answers 401)
  else if (e.code === '42P01' || e.code === '42883') status = 404;
  else if (e.code && e.code.startsWith('23')) status = 409;
  else if (e.code === '57014') status = 504;
  else if (!e.code) status = 500;
  return { status, body };
}

async function asAnon(req, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    await client.query("select set_config('request.headers', $1, true), set_config('request.method', $2, true)", [
      JSON.stringify(req.headers),
      req.method,
    ]);
    const out = await work(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

async function callRpc(req, res, name) {
  const fns = (await functions()).get(name);
  if (!fns) {
    send(res, 404, { code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${name}` });
    return;
  }
  let args;
  try {
    args = await readBody(req);
  } catch {
    send(res, 400, { code: 'PGRST102', details: null, hint: null, message: 'Empty or invalid json' });
    return;
  }
  const keys = Object.keys(args || {});
  const fn = pickOverload(fns, keys);
  if (!fn || fn === 'ambiguous') {
    send(res, fn ? 300 : 404, {
      code: fn ? 'PGRST203' : 'PGRST202',
      details: null,
      hint: null,
      message: `Could not choose the function public.${name}(${keys.join(', ')})`,
    });
    return;
  }
  const params = [];
  const named = keys.map((k) => {
    const type = fn.argtypes[fn.argnames.indexOf(k)];
    params.push(toParam(args[k], type));
    return `"${k}" => $${params.length}::${type}`;
  });
  const call = `public."${name}"(${named.join(', ')})`;
  let sql;
  if (fn.rettype === 'void') sql = `select ${call}`;
  else if (fn.retset) sql = `select coalesce(json_agg(t), '[]')::text as r from ${call} t`;
  else sql = `select to_json(${call})::text as r`;
  try {
    const out = await asAnon(req, (c) => c.query(sql, params));
    if (fn.rettype === 'void') send(res, 204);
    else send(res, 200, out.rows[0].r ?? 'null');
  } catch (e) {
    const { status, body } = pgError(e);
    send(res, status, body);
  }
}

function filters(url) {
  const where = [];
  const params = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
    if (!IDENT.test(k)) throw Object.assign(new Error(`bad column ${k}`), { code: 'PGRST100' });
    if (v === 'not.is.null') where.push(`"${k}" is not null`);
    else if (v === 'is.null') where.push(`"${k}" is null`);
    else if (v.startsWith('eq.')) {
      params.push(v.slice(3));
      where.push(`"${k}"::text = $${params.length}`);
    } else throw Object.assign(new Error(`unsupported filter ${k}=${v}`), { code: 'PGRST100' });
  }
  return { where: where.length ? ` where ${where.join(' and ')}` : '', params };
}

async function tableRequest(req, res, table, url) {
  if (!IDENT.test(table)) {
    send(res, 404, { code: 'PGRST205', details: null, hint: null, message: 'Unknown table' });
    return;
  }
  try {
    const { where, params } = filters(url);
    let sql;
    if (req.method === 'GET') {
      const cols = (url.searchParams.get('select') || '*').split(',').map((c) => c.trim());
      if (!cols.every((c) => c === '*' || IDENT.test(c))) throw Object.assign(new Error('bad select'), { code: 'PGRST100' });
      const limit = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
      sql = `select coalesce(json_agg(t), '[]')::text as r from (select ${cols.map((c) => (c === '*' ? c : `"${c}"`)).join(', ')} from public."${table}"${where} limit ${limit}) t`;
    } else if (req.method === 'POST' || req.method === 'PATCH') {
      const body = await readBody(req);
      const cols = Object.keys(body);
      if (!cols.length || !cols.every((c) => IDENT.test(c))) throw Object.assign(new Error('bad body'), { code: 'PGRST102' });
      const values = cols.map((c) => body[c]);
      if (req.method === 'POST') {
        const ph = values.map((_, i) => `$${params.length + i + 1}`);
        sql = `insert into public."${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values (${ph.join(', ')})`;
      } else {
        const sets = cols.map((c, i) => `"${c}" = $${params.length + i + 1}`);
        sql = `update public."${table}" set ${sets.join(', ')}${where}`;
      }
      params.push(...values);
    } else if (req.method === 'DELETE') {
      sql = `delete from public."${table}"${where}`;
    } else {
      send(res, 405, { code: 'PGRST117', details: null, hint: null, message: 'Unsupported method' });
      return;
    }
    const out = await asAnon(req, (c) => c.query(sql, params));
    if (req.method === 'GET') send(res, 200, out.rows[0].r);
    else send(res, req.method === 'POST' ? 201 : 204);
  } catch (e) {
    const { status, body } = pgError(e);
    send(res, status, body);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return send(res, 204);
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_][a-z0-9_]*)$/);
  if (rpc) {
    if (req.method !== 'POST') return send(res, 405, { code: 'PGRST117', details: null, hint: null, message: 'Use POST' });
    return callRpc(req, res, rpc[1]);
  }
  const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/);
  if (table) return tableRequest(req, res, table[1], url);
  return send(res, 404, { code: 'PGRST000', details: null, hint: null, message: 'Not found' });
});

// Realtime is not emulated: refuse WebSocket upgrades so clients fall back to polling.
server.on('upgrade', (_req, socket) => socket.destroy());

server.listen(PORT, () => {
  console.log(`local Data API on http://localhost:${PORT} -> ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
});
