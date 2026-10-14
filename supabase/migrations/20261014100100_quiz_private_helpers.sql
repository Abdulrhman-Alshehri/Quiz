-- NPS Live Quiz: server-side logic.
--
-- All functions that touch data are SECURITY DEFINER with an empty search_path,
-- so every object is schema-qualified. Errors are raised with a short code as
-- the message (for example NAME_TAKEN); the web app maps codes to friendly text.
--
-- Timing: question_started_at and question_deadline come from the database
-- clock. An answer is accepted only while the question is open and before the
-- deadline plus a small network grace period (settings.graceMs, default 1000 ms).
-- Points use the time remaining at the moment the database receives the answer.

-- ===========================================================================
-- Private helpers
-- ===========================================================================
create or replace function app_private.hash_token(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function app_private.new_token()
returns text language sql volatile set search_path = '' as $$
  select encode(extensions.gen_random_bytes(32), 'hex')
$$;

create or replace function app_private.gen_session_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code  text;
  i int;
begin
  loop
    v_bytes := extensions.gen_random_bytes(6);
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.sessions s where s.code = v_code);
  end loop;
  return v_code;
end $$;

create or replace function app_private.client_key()
returns text language plpgsql stable set search_path = '' as $$
declare
  v_headers json;
  v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  if v_headers is not null then
    v_ip := coalesce(v_headers->>'cf-connecting-ip',
                     v_headers->>'x-real-ip',
                     split_part(v_headers->>'x-forwarded-for', ',', 1));
  end if;
  return coalesce(nullif(trim(v_ip), ''), 'unknown');
end $$;

create or replace function app_private.require_admin(p_admin_token text)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_admin_token is null or not exists (
    select 1 from app_private.admin_tokens t
    where t.token_hash = app_private.hash_token(p_admin_token)
      and t.expires_at > now()
  ) then
    raise exception 'ADMIN_AUTH_REQUIRED';
  end if;
end $$;

create or replace function app_private.participant_by_token(p_token text)
returns public.participants language plpgsql stable set search_path = '' as $$
declare
  v public.participants;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'PARTICIPANT_NOT_FOUND';
  end if;
  select * into v from public.participants p where p.token_hash = app_private.hash_token(p_token);
  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND';
  end if;
  if v.removed_at is not null then
    raise exception 'PARTICIPANT_REMOVED';
  end if;
  return v;
end $$;

create or replace function app_private.bump(p_session_id uuid)
returns void language sql volatile set search_path = '' as $$
  update public.sessions set version = version + 1, updated_at = now() where id = p_session_id
$$;

-- Merge requested settings into a base (defaults when base is null) and validate.
create or replace function app_private.normalize_settings(p_in jsonb, p_base jsonb default null)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v    jsonb := coalesce(p_base, jsonb_build_object(
            'durationOverride', null,
            'scoringMode', 'linear',
            'feedbackMode', 'on_reveal',
            'autoAdvance', false,
            'autoNextDelaySec', 8,
            'leadInMs', 4000,
            'graceMs', 1000,
            'screenLeaderboardSize', 10));
  v_in jsonb := coalesce(p_in, '{}'::jsonb);
  v_n  int;
begin
  if v_in ? 'durationOverride' then
    if jsonb_typeof(v_in->'durationOverride') = 'null' then
      v := v || jsonb_build_object('durationOverride', null);
    else
      v_n := (v_in->>'durationOverride')::int;
      if v_n < 5 or v_n > 120 then raise exception 'INVALID_SETTING:durationOverride'; end if;
      v := v || jsonb_build_object('durationOverride', v_n);
    end if;
  end if;
  if v_in ? 'scoringMode' then
    if coalesce(v_in->>'scoringMode', '') not in ('linear', 'half_floor') then
      raise exception 'INVALID_SETTING:scoringMode';
    end if;
    v := v || jsonb_build_object('scoringMode', v_in->>'scoringMode');
  end if;
  if v_in ? 'feedbackMode' then
    if coalesce(v_in->>'feedbackMode', '') not in ('on_reveal', 'immediate') then
      raise exception 'INVALID_SETTING:feedbackMode';
    end if;
    v := v || jsonb_build_object('feedbackMode', v_in->>'feedbackMode');
  end if;
  if v_in ? 'autoAdvance' then
    v := v || jsonb_build_object('autoAdvance', coalesce((v_in->>'autoAdvance')::boolean, false));
  end if;
  if v_in ? 'autoNextDelaySec' then
    v_n := (v_in->>'autoNextDelaySec')::int;
    if v_n < 3 or v_n > 60 then raise exception 'INVALID_SETTING:autoNextDelaySec'; end if;
    v := v || jsonb_build_object('autoNextDelaySec', v_n);
  end if;
  if v_in ? 'leadInMs' then
    v_n := (v_in->>'leadInMs')::int;
    if v_n < 0 or v_n > 10000 then raise exception 'INVALID_SETTING:leadInMs'; end if;
    v := v || jsonb_build_object('leadInMs', v_n);
  end if;
  if v_in ? 'graceMs' then
    v_n := (v_in->>'graceMs')::int;
    if v_n < 0 or v_n > 3000 then raise exception 'INVALID_SETTING:graceMs'; end if;
    v := v || jsonb_build_object('graceMs', v_n);
  end if;
  if v_in ? 'screenLeaderboardSize' then
    v_n := (v_in->>'screenLeaderboardSize')::int;
    if v_n < 3 or v_n > 20 then raise exception 'INVALID_SETTING:screenLeaderboardSize'; end if;
    v := v || jsonb_build_object('screenLeaderboardSize', v_n);
  end if;
  return v;
end $$;

-- Points for one answer. Server-side source of truth (mirrored in src/utils/scoring.js).
--   linear     (PRD default): round(1000 * remaining / total)          -> 0..1000
--   half_floor (Kahoot-like): round(1000 * (1 - (elapsed / total) / 2)) -> 500..1000
create or replace function app_private.question_points(
  p_correct boolean, p_elapsed_ms int, p_remaining_ms int, p_duration_ms int, p_mode text)
returns int language sql immutable set search_path = '' as $$
  select case
    when not coalesce(p_correct, false) or coalesce(p_duration_ms, 0) <= 0 then 0
    when p_mode = 'half_floor' then
      round(1000 * (1 - (least(greatest(p_elapsed_ms, 0), p_duration_ms)::numeric / p_duration_ms) / 2))::int
    else
      round(1000 * least(greatest(p_remaining_ms, 0), p_duration_ms)::numeric / p_duration_ms)::int
  end
$$;
