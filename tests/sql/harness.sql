-- Local stand-ins for Supabase auth and Realtime. The hosted project already
-- has these; this file is only for the Postgres RLS test and is not a migration.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create schema if not exists realtime;

create table if not exists realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text,
  extension text not null default 'broadcast',
  payload jsonb,
  event text,
  private boolean default true,
  inserted_at timestamptz not null default now()
);

alter table realtime.messages enable row level security;

create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('realtime.topic', true), '')::text;
$$;
