alter table public.binders add column if not exists local_id text;
create unique index if not exists binders_user_local_id_unique
  on public.binders (user_id, local_id);
alter table public.binders add column if not exists collection_items jsonb not null default '[]'::jsonb;
