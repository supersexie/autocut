-- Autocut: the state every server shares, so many can run at once.
-- Run once in Supabase → SQL editor (or `supabase db push`). Safe to run again.
-- Servers connect with DATABASE_URL (Supabase → Connect → Session pooler). Row level security is
-- on with no policies, so the app's public key can't read these tables; only the servers can.

-- One row per cut: where it is, what was found, and its latest export.
create table if not exists cuts (
  id uuid primary key,
  user_id text not null,
  stage text not null,            -- scheduled | queued | joining | reading | listening | cutting | ready | failed | stopped
  progress real not null default 0,
  error text,
  takes int not null default 1,
  at timestamptz,                 -- when a scheduled cut runs
  run jsonb,                      -- how to cut it: upload keys, flips, blend, options
  result jsonb,                   -- duration, keptDuration, segments, cuts, words, waveform
  source text,                    -- storage key of the video the editor plays
  render jsonb,                   -- latest export: id, stage, progress, error, size, key
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cuts_user on cuts (user_id, created_at desc);

-- The job list. Any server's worker claims the next job with FOR UPDATE SKIP LOCKED, so two never
-- take the same one, and a job whose worker stops sending heartbeats goes back on the list.
create table if not exists tasks (
  id bigserial primary key,
  cut_id uuid not null references cuts (id) on delete cascade,
  kind text not null,             -- cut | render | preview
  payload jsonb not null default '{}',
  priority int not null default 0, -- previews go first: someone is waiting in the editor
  status text not null default 'queued', -- queued | running | done | failed | stopped
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  locked_by text,
  heartbeat timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists tasks_ready on tasks (priority desc, run_at, id) where status = 'queued';
create index if not exists tasks_running on tasks (heartbeat) where status = 'running';
create index if not exists tasks_cut on tasks (cut_id, kind);

-- Edits started per account per month (the plan limits).
create table if not exists usage (
  user_id text not null,
  month text not null,            -- 2026-10 (UTC)
  used int not null default 0,
  primary key (user_id, month)
);

-- What each account agreed to and when: the terms and privacy policy, and (separately) letting
-- their videos be used to improve Autocut and its AI.
create table if not exists consents (
  user_id text primary key,
  terms_version text,
  terms_at timestamptz,
  ai boolean not null default false,
  ai_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table cuts enable row level security;
alter table tasks enable row level security;
alter table usage enable row level security;
alter table consents enable row level security;
