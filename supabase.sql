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

-- ── ideas ──────────────────────────────────────────────────────────────────
create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  last_edited_at timestamptz
);

alter table ideas enable row level security;

drop policy if exists "ideas: select own" on ideas;
drop policy if exists "ideas: insert own" on ideas;
drop policy if exists "ideas: update own" on ideas;
drop policy if exists "ideas: delete own" on ideas;

create policy "ideas: select own" on ideas for select using (auth.uid() = user_id);
create policy "ideas: insert own" on ideas for insert with check (auth.uid() = user_id);
create policy "ideas: update own" on ideas for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ideas: delete own" on ideas for delete using (auth.uid() = user_id);

-- ── idea_coats: one row per editing session ("coat of paint") ──────────────
create table if not exists idea_coats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idea_id uuid not null references ideas(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idea_coats_idea_id_idx on idea_coats (idea_id);

alter table idea_coats enable row level security;

drop policy if exists "idea_coats: select own" on idea_coats;
drop policy if exists "idea_coats: insert own" on idea_coats;

create policy "idea_coats: select own" on idea_coats for select using (auth.uid() = user_id);

-- Append-only on purpose: there is no update or delete policy, so a coat can
-- never be edited or removed from the client. (Deleting the idea still clears
-- its coats — foreign-key cascades don't go through row-level security.)
-- The insert check also refuses a coat pointed at someone else's idea.
create policy "idea_coats: insert own" on idea_coats for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from ideas
      where ideas.id = idea_coats.idea_id and ideas.user_id = auth.uid()
    )
  );
