-- P23: image attachments. Run ONCE in the thrive-console Supabase project (SQL editor).
--
-- Additive and idempotent: it creates one public-read Storage bucket, console-attachments, and the
-- row-level policies on storage.objects that let a signed-in operator upload into it and anyone read it.
-- Re-running changes nothing. It touches no console_ table and no pre-existing bucket.
--
-- Why a bucket, not a column: an image is stored once as an object and the compiled email references its
-- URL (Resend fetches it by `path`), so the mail body never carries base64 and the 400 KB relay JSON and
-- the browser store are never the ceiling. Public-read is deliberate: the recipient's mail client and
-- Resend both fetch the image unauthenticated, exactly as a hosted image link must be reachable.

-- 1) The bucket. `public = true` makes objects readable at /storage/v1/object/public/console-attachments/…
--    on conflict do nothing keeps a re-run a no-op and never resets an existing bucket's settings.
insert into storage.buckets (id, name, public)
values ('console-attachments', 'console-attachments', true)
on conflict (id) do nothing;

-- 2) Row-level policies on storage.objects, scoped to THIS bucket only. Guarded so a re-run adds nothing.
do $$
begin
  -- read: anyone (anon + authenticated). A recipient's mail client and Resend fetch the image with no session.
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='console_attachments_read') then
    execute 'create policy console_attachments_read on storage.objects for select using (bucket_id = ''console-attachments'')';
  end if;

  -- insert: only a signed-in operator may upload, and only into this bucket. No anon writes.
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='console_attachments_insert') then
    execute 'create policy console_attachments_insert on storage.objects for insert to authenticated with check (bucket_id = ''console-attachments'')';
  end if;

  -- update: a signed-in operator may overwrite (the client sends x-upsert on re-upload of the same path).
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='console_attachments_update') then
    execute 'create policy console_attachments_update on storage.objects for update to authenticated using (bucket_id = ''console-attachments'') with check (bucket_id = ''console-attachments'')';
  end if;
end $$;
