-- Run in Supabase: Project → SQL Editor → New query → paste ALL of this → Run.
-- Safe to re-run.

-- ── entries ────────────────────────────────────────────────────────────────
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,          -- matches habits.key
  date date not null,
  done boolean not null default true,
  value integer,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, habit_id, date)
);

alter table entries enable row level security;

drop policy if exists "entries: select own" on entries;
drop policy if exists "entries: insert own" on entries;
drop policy if exists "entries: update own" on entries;
drop policy if exists "entries: delete own" on entries;

create policy "entries: select own" on entries for select using (auth.uid() = user_id);
create policy "entries: insert own" on entries for insert with check (auth.uid() = user_id);
create policy "entries: update own" on entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "entries: delete own" on entries for delete using (auth.uid() = user_id);

-- ── habits ─────────────────────────────────────────────────────────────────
create table if not exists habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,               -- stable; entries.habit_id points at this
  name text not null,
  emoji text not null default '✅',
  type text not null default 'boolean',
  target integer,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

-- config columns for the preset habits
alter table habits add column if not exists unit text;
alter table habits add column if not exists time_of_day text;

-- migrate the old type name, then re-apply the constraint
alter table habits drop constraint if exists habits_type_check;
update habits set type = 'duration', unit = coalesce(unit, 'min') where type = 'minutes';
alter table habits add constraint habits_type_check
  check (type in ('boolean', 'time', 'duration', 'count'));

alter table habits enable row level security;

drop policy if exists "habits: select own" on habits;
drop policy if exists "habits: insert own" on habits;
drop policy if exists "habits: update own" on habits;
drop policy if exists "habits: delete own" on habits;

create policy "habits: select own" on habits for select using (auth.uid() = user_id);
create policy "habits: insert own" on habits for insert with check (auth.uid() = user_id);
create policy "habits: update own" on habits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "habits: delete own" on habits for delete using (auth.uid() = user_id);
