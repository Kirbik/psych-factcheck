alter table public.content_items
  add column storage_path text,
  add column original_file_name text,
  add column file_size_bytes bigint,
  add column file_mime_type text,
  add column upload_id uuid;

alter table public.content_items
  add constraint content_items_file_size_bytes_check
  check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 104857600));

alter table public.content_items
  add constraint content_items_upload_id_key unique (user_id, upload_id);

alter table public.content_items
  add constraint content_items_storage_path_check
  check (storage_path is null or storage_path like (user_id::text || '/%'));

insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do update set public = excluded.public;

create policy "videos: insert own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "videos: select own"
on storage.objects for select to authenticated
using (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "videos: update own"
on storage.objects for update to authenticated
using (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "videos: delete own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'videos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
