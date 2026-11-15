-- Messagerie liée aux dossiers, entre l'étudiant et le conseiller actuellement attribué.
create table public.messages (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.applications(id) on delete cascade,
 sender_id uuid not null references auth.users(id), receiver_id uuid not null references auth.users(id),
 content text not null check(length(trim(content)) between 1 and 5000),
 created_at timestamptz not null default now(), read_at timestamptz,
 check(sender_id <> receiver_id)
);
create index messages_application_created_idx on public.messages(application_id,created_at);
create index messages_receiver_idx on public.messages(receiver_id,created_at desc);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 application_id uuid references public.applications(id) on delete cascade,
 title text not null, message text not null, type text not null default 'message',
 read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications(user_id,created_at desc);
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

create function public.message_can_send(app_id uuid, recipient uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.applications a where a.id=app_id and a.assigned_advisor is not null and recipient<>auth.uid() and (
  (a.student_id=auth.uid() and a.assigned_advisor=recipient and exists(select 1 from public.user_roles r where r.user_id=recipient and r.role='academic_advisor')) or
  (a.assigned_advisor=auth.uid() and a.student_id=recipient and public.has_role(array['academic_advisor']))
 ))
$$;
revoke all on function public.message_can_send(uuid,uuid) from public,anon;
grant execute on function public.message_can_send(uuid,uuid) to authenticated;

create policy messages_participant_read on public.messages for select to authenticated using (
 public.has_role(array['super_admin','admin']) or exists(select 1 from public.applications a where a.id=application_id and (
  a.student_id=auth.uid() or (a.assigned_advisor=auth.uid() and public.has_role(array['academic_advisor']) and (sender_id=auth.uid() or receiver_id=auth.uid()))
 ))
);
create policy messages_participant_insert on public.messages for insert to authenticated with check (
 sender_id=auth.uid() and read_at is null and public.message_can_send(application_id,receiver_id)
);
create policy notifications_owner_read on public.notifications for select to authenticated using (user_id=auth.uid());
-- Aucun client ne peut modifier un message ou fabriquer une notification directement.
revoke all on public.messages from anon,authenticated;
revoke all on public.notifications from anon,authenticated;
grant select on public.messages,public.notifications to authenticated;
grant insert(application_id,sender_id,receiver_id,content) on public.messages to authenticated;

create function public.notify_new_message() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.notifications(user_id,application_id,title,message,type) values(new.receiver_id,new.application_id,'Nouveau message','Un nouveau message vous attend dans votre dossier.','message');
 return new;
end $$;
revoke all on function public.notify_new_message() from public,anon,authenticated;
create trigger notify_after_message after insert on public.messages for each row execute function public.notify_new_message();

create function public.mark_application_messages_read(app_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.applications a where a.id=app_id and (a.student_id=auth.uid() or (a.assigned_advisor=auth.uid() and public.has_role(array['academic_advisor'])))) then raise exception 'Accès interdit'; end if;
 update public.messages set read_at=now() where application_id=app_id and receiver_id=auth.uid() and read_at is null;
end $$;
create function public.mark_notification_read(notification_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.notifications set read_at=coalesce(read_at,now()) where id=notification_id and user_id=auth.uid();
 if not found then raise exception 'Notification introuvable'; end if;
end $$;
revoke all on function public.mark_application_messages_read(uuid) from public,anon;
revoke all on function public.mark_notification_read(uuid) from public,anon;
grant execute on function public.mark_application_messages_read(uuid), public.mark_notification_read(uuid) to authenticated;

create function public.notify_application_change() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status is distinct from old.status then
  insert into public.notifications(user_id,application_id,title,message,type) values(new.student_id,new.id,'Mise à jour du dossier','Le statut de votre dossier a changé.','status');
 end if;
 if new.assigned_advisor is distinct from old.assigned_advisor then
  insert into public.notifications(user_id,application_id,title,message,type) values(new.student_id,new.id,'Conseiller mis à jour','L’attribution de votre dossier a changé.','assignment');
  if new.assigned_advisor is not null and new.assigned_advisor <> new.student_id then
   insert into public.notifications(user_id,application_id,title,message,type) values(new.assigned_advisor,new.id,'Dossier attribué','Un dossier vous a été attribué.','assignment');
  end if;
 end if;
 return new;
end $$;
revoke all on function public.notify_application_change() from public,anon,authenticated;
create trigger notify_application_changes after update of status,assigned_advisor on public.applications for each row execute function public.notify_application_change();

-- Les événements Realtime restent soumis aux politiques RLS.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
