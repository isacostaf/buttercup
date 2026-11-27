-- Buttercup — rode isto uma vez no Supabase: SQL Editor → New query → colar → Run.

create table if not exists public.recipes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  labels      text[] not null default '{}',
  ingredients text[] not null default '{}',
  steps       text[] not null default '{}',
  notes       text not null default '',
  source      text not null default '',
  photo       text,                 -- foto grande (JPEG em data URL), carregada só ao abrir a receita
  thumb       text,                 -- miniatura pequena para a lista
  has_photo   boolean generated always as (photo is not null) stored,
  favorite    boolean not null default false,
  diary       jsonb not null default '[]'::jsonb,   -- [{id, date, stars, text}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists recipes_user_id_idx on public.recipes (user_id);

-- Segurança: cada usuário só vê e altera as próprias receitas.
alter table public.recipes enable row level security;

drop policy if exists "own recipes" on public.recipes;
create policy "own recipes" on public.recipes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
