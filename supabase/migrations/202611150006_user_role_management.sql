-- La gestion des rôles passe exclusivement par une fonction auditée.
revoke insert, update, delete on public.user_roles from public, anon, authenticated;
drop policy if exists roles_insert on public.user_roles;
drop policy if exists roles_delete on public.user_roles;

-- Les résultats sont bornés ; l'e-mail et sa confirmation viennent de Auth et non du profil modifiable.
create function public.admin_list_users(search_text text default '', page_offset integer default 0)
returns table(id uuid, full_name text, email text, email_confirmed boolean, created_at timestamptz, roles text[])
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.has_role(array['super_admin']) then raise exception 'Accès interdit'; end if;
 if page_offset is null or page_offset < 0 or page_offset > 1000000 or search_text is null or length(search_text)>200 then raise exception 'Paramètres invalides'; end if;
 return query
 select p.id,p.full_name,coalesce(u.email,''),u.email_confirmed_at is not null,p.created_at,
 coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id=p.id),array[]::text[])
 from public.profiles p join auth.users u on u.id=p.id
 where search_text='' or strpos(lower(p.full_name),lower(trim(search_text)))>0 or strpos(lower(coalesce(u.email,'')),lower(trim(search_text)))>0
 order by p.created_at desc,p.id desc limit 26 offset page_offset;
end $$;

-- Sérialiser les attributions de dossier avec la révocation du rôle conseiller.
create or replace function public.assign_application_advisor(application_id uuid, advisor_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.has_role(array['super_admin','admin']) then raise exception 'Accès interdit'; end if;
 if advisor_id is not null then
  perform pg_advisory_xact_lock(hashtextextended(advisor_id::text,0));
  if not exists(select 1 from public.user_roles where user_id=advisor_id and role='academic_advisor') then raise exception 'Conseiller invalide'; end if;
 end if;
 update public.applications set assigned_advisor=advisor_id,updated_at=now() where id=application_id;
 if not found then raise exception 'Dossier introuvable'; end if;
 insert into public.activity_logs(user_id,action,entity,entity_id) values(auth.uid(),'assign_advisor','application',application_id);
end $$;

-- Même verrou pour les affectations d'orientation, y compris par accès direct autorisé.
create function public.check_orientation_advisor() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.assigned_advisor is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.assigned_advisor::text,0));
  if not exists(select 1 from public.user_roles where user_id=new.assigned_advisor and role='academic_advisor') then raise exception 'Conseiller invalide'; end if;
 end if;
 return new;
end $$;
revoke all on function public.check_orientation_advisor() from public,anon,authenticated;
create trigger check_orientation_advisor before insert or update of assigned_advisor on public.orientation_requests for each row execute function public.check_orientation_advisor();

create function public.admin_set_user_role(target_user uuid, target_role text, grant_role boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare changed integer;
begin
 if not public.has_role(array['super_admin']) then raise exception 'Accès interdit'; end if;
 if target_user is null or target_user=auth.uid() then raise exception 'Modification de son propre compte interdite'; end if;
 if target_role is null or target_role not in ('admin','editor','scholarship_manager','academic_advisor','application_manager','visa_manager','training_manager') or grant_role is null then raise exception 'Rôle non modifiable'; end if;
 if not exists(select 1 from public.profiles where id=target_user) then raise exception 'Utilisateur introuvable'; end if;
 if grant_role and not exists(select 1 from auth.users where id=target_user and email_confirmed_at is not null) then raise exception 'Compte non confirmé'; end if;
 if target_role='academic_advisor' then
  perform pg_advisory_xact_lock(hashtextextended(target_user::text,0));
  if not grant_role and (exists(select 1 from public.applications where assigned_advisor=target_user) or exists(select 1 from public.orientation_requests where assigned_advisor=target_user)) then
   raise exception 'Réattribuez les dossiers et demandes d’orientation avant de retirer ce rôle';
  end if;
 end if;
 if grant_role then
  insert into public.user_roles(user_id,role) values(target_user,target_role) on conflict(user_id,role) do nothing;
 else
  delete from public.user_roles where user_id=target_user and role=target_role;
 end if;
 get diagnostics changed = row_count;
 if changed=0 then raise exception 'Aucun changement effectué'; end if;
 insert into public.activity_logs(user_id,action,entity,entity_id) values(auth.uid(),case when grant_role then 'role_grant:' else 'role_revoke:' end || target_role,'user_role',target_user);
end $$;
revoke all on function public.admin_list_users(text,integer), public.admin_set_user_role(uuid,text,boolean) from public,anon;
grant execute on function public.admin_list_users(text,integer), public.admin_set_user_role(uuid,text,boolean) to authenticated;
