create type public.content_item_type as enum ('video');
create type public.content_item_status as enum ('pending', 'ready', 'failed');
create type public.analysis_job_status as enum (
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.content_item_type not null default 'video',
  status public.content_item_status not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (id, user_id)
);

create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content_item_id uuid not null,
  status public.analysis_job_status not null default 'queued',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  foreign key (content_item_id, user_id)
    references public.content_items (id, user_id)
    on delete cascade
);

create index content_items_user_id_created_at_idx
  on public.content_items (user_id, created_at desc);
create index analysis_jobs_user_id_created_at_idx
  on public.analysis_jobs (user_id, created_at desc);
create index analysis_jobs_content_item_id_idx
  on public.analysis_jobs (content_item_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger content_items_set_updated_at
before update on public.content_items
for each row execute function public.set_updated_at();

create trigger analysis_jobs_set_updated_at
before update on public.analysis_jobs
for each row execute function public.set_updated_at();

create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

revoke all on function public.set_updated_at() from public;
revoke all on function public.create_profile_for_new_user() from public;

alter table public.profiles enable row level security;
alter table public.content_items enable row level security;
alter table public.analysis_jobs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.content_items to authenticated;
grant select on public.analysis_jobs to authenticated;

create policy "profiles: select own"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "profiles: update own"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "content items: select own"
on public.content_items for select to authenticated
using ((select auth.uid()) = user_id);

create policy "content items: insert own"
on public.content_items for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "content items: update own"
on public.content_items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "content items: delete own"
on public.content_items for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "analysis jobs: select own"
on public.analysis_jobs for select to authenticated
using ((select auth.uid()) = user_id);
