create schema if not exists app_private;
revoke all on schema app_private from public;

create function app_private.create_profile_for_new_user()
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.create_profile_for_new_user();

revoke all on function app_private.create_profile_for_new_user() from public;
drop function public.create_profile_for_new_user();
