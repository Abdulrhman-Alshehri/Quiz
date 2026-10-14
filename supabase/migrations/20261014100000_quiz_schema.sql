-- NPS Live Quiz: schema, row-level security and realtime publication.
--
-- Security model
--   * Participants and the presenter use the public (anon / publishable) key.
--   * No table is writable through the Data API. Every write goes through a
--     SECURITY DEFINER function in 0002 that validates a participant token or an
--     admin token and uses the database clock for deadlines and scoring.
--   * Only public.sessions is readable (needed for Realtime change events). It
--     holds no answer keys, tokens or personal data.
--   * Answer keys, participant tokens and answers are unreadable through the API.
--   * Admin secrets live in the app_private schema, which the API does not expose.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------------------
-- Question bank (template for new sessions). Admin-only.
-- ---------------------------------------------------------------------------
create table public.bank_chapters (
  id          text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  title       text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 300),
  sort_order  int  not null,
  updated_at  timestamptz not null default now()
);

create table public.bank_questions (
  id                text primary key check (id ~ '^[a-z0-9_-]{1,60}$'),
  chapter_id        text not null references public.bank_chapters(id) on delete cascade,
  sort_order        int  not null,
  question_text     text not null check (char_length(question_text) between 1 and 300),
  options           jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option_id text not null check (correct_option_id in ('A','B','C','D')),
  explanation       text not null default '' check (char_length(explanation) <= 400),
  duration_seconds  int  not null default 20 check (duration_seconds between 5 and 120),
  source_ref        text not null default '',
  updated_at        timestamptz not null default now(),
  unique (chapter_id, sort_order)
);

-- ---------------------------------------------------------------------------
-- Sessions and their snapshot of the bank
-- ---------------------------------------------------------------------------
create table public.sessions (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code ~ '^[A-Z0-9]{4,8}$'),
  title                 text not null check (char_length(title) between 1 and 120),
  status                text not null default 'lobby' check (status in ('lobby','live','ended')),
  registration_open     boolean not null default true,
  phase                 text not null default 'idle'
                        check (phase in ('idle','chapter_intro','question','reveal','chapter_results','ended')),
  active_chapter_id     text,
  active_question_id    text,
  active_question_index int,
  question_started_at   timestamptz,   -- answers open (after the lead-in)
  question_deadline     timestamptz,   -- authoritative deadline (database clock)
  paused                boolean not null default false,
  paused_remaining_ms   int,
  settings              jsonb not null default '{}'::jsonb,
  version               bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  ended_at              timestamptz
);

create table public.session_chapters (
  session_id   uuid not null references public.sessions(id) on delete cascade,
  chapter_id   text not null,
  title        text not null,
  description  text not null default '',
  sort_order   int  not null,
  status       text not null default 'locked' check (status in ('locked','open','completed')),
  opened_at    timestamptz,
  completed_at timestamptz,
  primary key (session_id, chapter_id)
);

create table public.session_questions (
  session_id        uuid not null,
  question_id       text not null,
  chapter_id        text not null,
  sort_order        int  not null,
  question_text     text not null,
  options           jsonb not null,
  correct_option_id text not null,
  explanation       text not null default '',
  duration_seconds  int  not null check (duration_seconds between 5 and 120),
  launched_at       timestamptz,
  revealed_at       timestamptz,
  primary key (session_id, question_id),
  foreign key (session_id, chapter_id)
    references public.session_chapters(session_id, chapter_id) on delete cascade
);
create index session_questions_chapter_idx
  on public.session_questions (session_id, chapter_id, sort_order);

-- ---------------------------------------------------------------------------
-- Participants and answers
-- ---------------------------------------------------------------------------
create table public.participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  name_key     text not null,
  token_hash   text not null unique,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at   timestamptz
);
create index participants_session_idx on public.participants (session_id);
create unique index participants_session_name_uq
  on public.participants (session_id, name_key) where removed_at is null;

create table public.answers (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null,
  participant_id     uuid not null references public.participants(id) on delete cascade,
  question_id        text not null,
  chapter_id         text not null,
  selected_option_id text,
  status             text not null check (status in ('answered','timed_out')),
  is_correct         boolean not null default false,
  points_awarded     int not null default 0 check (points_awarded between 0 and 1000),
  response_time_ms   int,
  submitted_at       timestamptz not null default now(),
  voided_at          timestamptz,
  void_reason        text,
  foreign key (session_id, question_id)
    references public.session_questions(session_id, question_id) on delete cascade
);
-- Exactly one live answer per participant per question (voided rows are kept for audit).
create unique index answers_one_per_question_uq
  on public.answers (participant_id, question_id) where voided_at is null;
create index answers_session_question_idx on public.answers (session_id, question_id);
create index answers_participant_idx on public.answers (participant_id);

-- ---------------------------------------------------------------------------
-- Admin secrets (not exposed by the Data API)
-- ---------------------------------------------------------------------------
create table app_private.admin_config (
  id            int primary key default 1 check (id = 1),
  passcode_hash text not null,
  updated_at    timestamptz not null default now()
);

create table app_private.admin_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table app_private.admin_login_attempts (
  id           bigint generated always as identity primary key,
  client_key   text not null,
  attempted_at timestamptz not null default now(),
  success      boolean not null
);
create index admin_login_attempts_idx
  on app_private.admin_login_attempts (client_key, attempted_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: deny by default, sessions readable for Realtime.
-- ---------------------------------------------------------------------------
alter table public.bank_chapters     enable row level security;
alter table public.bank_questions    enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_chapters  enable row level security;
alter table public.session_questions enable row level security;
alter table public.participants      enable row level security;
alter table public.answers           enable row level security;

revoke all on public.bank_chapters, public.bank_questions, public.session_chapters,
              public.session_questions, public.participants, public.answers,
              public.sessions
  from anon, authenticated;

grant select on public.sessions to anon, authenticated;
create policy "Sessions are readable for live updates"
  on public.sessions for select to anon, authenticated using (true);

-- Realtime: clients subscribe to changes on their session row and refetch state.
alter publication supabase_realtime add table public.sessions;
