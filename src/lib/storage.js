// Browser storage can be blocked (private mode, strict settings). Every access is
// wrapped, and an in-memory copy keeps the current page working either way.
const PREFIX = 'npsquiz:';
const memory = new Map();

function read(key) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw !== null) return JSON.parse(raw);
  } catch {
    // fall through to memory
  }
  return memory.has(key) ? memory.get(key) : null;
}

function write(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // memory copy is enough for this page
  }
}

function remove(key) {
  memory.delete(key);
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // nothing to do
  }
}

// A "seat" is this browser's place in one session: token, ids and display name.
export function getSeat(sessionId) {
  return sessionId ? read(`seat:${sessionId}`) : null;
}

export function saveSeat(seat) {
  write(`seat:${seat.sessionId}`, seat);
  write('lastSeat', seat.sessionId);
}

export function clearSeat(sessionId) {
  remove(`seat:${sessionId}`);
  if (read('lastSeat') === sessionId) remove('lastSeat');
}

export function lastSeatSessionId() {
  return read('lastSeat');
}

export function getAdminToken() {
  const saved = read('admin');
  if (!saved || !saved.token) return null;
  if (Number.isNaN(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) < Date.now()) {
    remove('admin');
    return null;
  }
  return saved;
}

export function saveAdminToken(token, expiresAt) {
  write('admin', { token, expiresAt });
}

export function clearAdminToken() {
  remove('admin');
}
