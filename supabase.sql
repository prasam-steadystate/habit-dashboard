-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run.

create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id text not null,
  date date not null,
  done boolean not null default true,
  value integer,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, habit_id, date)
);

alter table entries enable row level security;

create policy "entries: select own"
  on entries for select
  using (auth.uid() = user_id);

create policy "entries: insert own"
  on entries for insert
  with check (auth.uid() = user_id);

create policy "entries: update own"
  on entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "entries: delete own"
  on entries for delete
  using (auth.uid() = user_id);
