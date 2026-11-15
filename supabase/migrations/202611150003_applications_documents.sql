-- Candidatures : aucune mise à jour directe depuis le client.
create table public.applications (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references auth.users(id) on delete cascade,
 scholarship_id uuid references public.scholarships(id) on delete set null,
 title text not null check (length(trim(title)) between 3 and 200),
 assigned_advisor uuid references auth.users(id) on delete set null,
 status text not null default 'recu' check (status in ('recu','en_etude','informations_demandees','en_accompagnement','candidature_preparee','soumise','acceptee','refusee','cloturee')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index applications_student_idx on public.applications(student_id);
create index applications_advisor_idx on public.applications(assigned_advisor);
alter table public.applications enable row level security;
create policy applications_student_insert on public.applications for insert to authenticated with check (
 student_id=auth.uid() and assigned_advisor is null and status='recu' and
 (scholarship_id is null or exists(select 1 from public.scholarships where id=scholarship_id and status='published'))
);
create policy applications_access on public.applications for select to authenticated using (
 student_id=auth.uid() or (assigned_advisor=auth.uid() and public.has_role(array['academic_advisor'])) or public.has_role(array['super_admin','admin'])
);
create policy profiles_assigned_advisor on public.profiles for select to authenticated using (
 public.has_role(array['academic_advisor']) and exists(select 1 from public.applications a where a.student_id=profiles.id and a.assigned_advisor=auth.uid())
);
create table public.application_notes (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications(id) on delete cascade,
 author_id uuid not null references auth.users(id), content text not null check (length(trim(content)) between 1 and 5000), created_at timestamptz not null default now()
);
create index application_notes_application_idx on public.application_notes(application_id);
alter table public.application_notes enable row level security;
create policy application_notes_staff_read on public.application_notes for select to authenticated using (
 public.has_role(array['super_admin','admin']) or (public.has_role(array['academic_advisor']) and exists(select 1 from public.applications a where a.id=application_id and a.assigned_advisor=auth.uid()))
);
create policy application_notes_staff_insert on public.application_notes for insert to authenticated with check (
 author_id=auth.uid() and (public.has_role(array['super_admin','admin']) or (public.has_role(array['academic_advisor']) and exists(select 1 from public.applications a where a.id=application_id and a.assigned_advisor=auth.uid())))
);
create table public.activity_logs (
 id bigint generated always as identity primary key, user_id uuid not null references auth.users(id), action text not null, entity text not null, entity_id uuid not null, created_at timestamptz not null default now()
);
alter table public.activity_logs enable row level security;
create policy activity_logs_admin_read on public.activity_logs for select to authenticated using (public.has_role(array['super_admin','admin']));
create function public.list_academic_advisors() returns table(id uuid, full_name text) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.has_role(array['super_admin','admin']) then raise exception 'Accès interdit'; end if;
 return query select p.id,p.full_name from public.profiles p where exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='academic_advisor') order by p.full_name;
end $$;
create function public.assign_application_advisor(application_id uuid, advisor_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.has_role(array['super_admin','admin']) then raise exception 'Accès interdit'; end if;
 if advisor_id is not null and not exists(select 1 from public.user_roles where user_id=advisor_id and role='academic_advisor') then raise exception 'Conseiller invalide'; end if;
 update public.applications set assigned_advisor=advisor_id,updated_at=now() where id=application_id;
 if not found then raise exception 'Dossier introuvable'; end if;
 insert into public.activity_logs(user_id,action,entity,entity_id) values(auth.uid(),'assign_advisor','application',application_id);
end $$;
create function public.update_application_status(application_id uuid, new_status text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new_status not in ('recu','en_etude','informations_demandees','en_accompagnement','candidature_preparee','soumise','acceptee','refusee','cloturee') then raise exception 'Statut invalide'; end if;
 update public.applications set status=new_status,updated_at=now() where id=application_id and
 (public.has_role(array['super_admin','admin']) or (assigned_advisor=auth.uid() and public.has_role(array['academic_advisor'])));
 if not found then raise exception 'Accès interdit ou dossier introuvable'; end if;
 insert into public.activity_logs(user_id,action,entity,entity_id) values(auth.uid(),'status:'||new_status,'application',application_id);
end $$;
revoke all on function public.list_academic_advisors() from public;
revoke all on function public.assign_application_advisor(uuid,uuid) from public;
revoke all on function public.update_application_status(uuid,text) from public;
grant execute on function public.list_academic_advisors() to authenticated;
grant execute on function public.assign_application_advisor(uuid,uuid) to authenticated;
grant execute on function public.update_application_status(uuid,text) to authenticated;
-- Bucket privé : seul le propriétaire voit, ajoute et supprime ses propres objets.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('student-documents','student-documents',false,5242880,array['application/pdf','image/jpeg','image/png']);
create policy student_documents_owner_select on storage.objects for select to authenticated using (bucket_id='student-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy student_documents_owner_insert on storage.objects for insert to authenticated with check (bucket_id='student-documents' and (storage.foldername(name))[1]=auth.uid()::text and array_length(storage.foldername(name),1)=1);
create policy student_documents_owner_delete on storage.objects for delete to authenticated using (bucket_id='student-documents' and (storage.foldername(name))[1]=auth.uid()::text);
