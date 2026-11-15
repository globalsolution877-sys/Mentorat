// PostgreSQL local éphémère. Simule les rôles et auth.uid, pas l'API Supabase.
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

let db
const users = { studentA: randomUUID(), studentB: randomUUID(), advisorA: randomUUID(), advisorB: randomUUID(), admin: randomUUID(), superAdmin: randomUUID() }
const cases = { a: randomUUID(), b: randomUUID() }

async function asUser(id, work) {
  await db.exec('BEGIN; SET LOCAL ROLE authenticated;')
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [id])
    return await work(db)
  } finally {
    await db.exec('ROLLBACK')
  }
}
async function asAnonymous(work) {
  await db.exec('BEGIN; SET LOCAL ROLE anon;')
  try { return await work(db) } finally { await db.exec('ROLLBACK') }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE PUBLICATION supabase_realtime;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA storage, public TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated;
    GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
  `)
  for (const file of ['202611150001_initial.sql','202611150002_publication_sources.sql','202611150003_applications_documents.sql']) {
    await db.exec(await readFile(new URL('../supabase/migrations/'+file, import.meta.url), 'utf8'))
  }
  // Supabase attribue parfois explicitement EXECUTE à anon ; reproduire cette situation.
  await db.exec('GRANT EXECUTE ON FUNCTION public.assign_application_advisor(uuid,uuid), public.update_application_status(uuid,text), public.list_academic_advisors() TO anon;')
  await db.exec(await readFile(new URL('../supabase/migrations/202611150004_restrict_rpc.sql',import.meta.url),'utf8'))
  // Les privilèges SQL explicites reproduisent ceux attendus de l'API Supabase.
  await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;')
  // Révoquer les grants par défaut sur les nouvelles tables sensibles via la migration réelle.
  await db.exec(await readFile(new URL('../supabase/migrations/202611150005_messages_notifications.sql',import.meta.url),'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/202611150006_user_role_management.sql',import.meta.url),'utf8'))
  for (const [name,id] of Object.entries(users)) await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data,email_confirmed_at) VALUES ($1,$2,$3,now())',[id, `${name}@example.invalid`, JSON.stringify({full_name:name})])
  for (const [id,role] of [[users.advisorA,'academic_advisor'],[users.advisorB,'academic_advisor'],[users.admin,'admin'],[users.superAdmin,'super_admin']]) await db.query('INSERT INTO public.user_roles(user_id,role) VALUES ($1,$2)',[id,role])
  await db.query('INSERT INTO public.applications(id,student_id,title,assigned_advisor) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',[cases.a,users.studentA,'Projet A',users.advisorA,cases.b,users.studentB,'Projet B',users.advisorB])
  await db.query('INSERT INTO public.application_notes(application_id,author_id,content) VALUES ($1,$2,$3)',[cases.a,users.advisorA,'Note interne de test'])
  await db.query('INSERT INTO public.messages(application_id,sender_id,receiver_id,content) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',[cases.a,users.studentA,users.advisorA,'Message A',cases.b,users.studentB,users.advisorB,'Message B'])
  await db.query('INSERT INTO storage.objects(bucket_id,name) VALUES ($1,$2),($1,$3)',['student-documents',`${users.studentA}/a.pdf`,`${users.studentB}/b.pdf`])
}, 30000)
afterAll(async () => { if (db) await db.close() })

describe('RLS — base PostgreSQL locale simulée', () => {
  it('isole les dossiers et les notes des étudiants', async () => {
    await asUser(users.studentA, async sql => {
      const applications = await sql.query('SELECT id FROM public.applications ORDER BY id')
      expect(applications.rows.map(x=>x.id)).toEqual([cases.a])
      expect((await sql.query('SELECT id FROM public.application_notes')).rows).toHaveLength(0)
      expect((await sql.query("UPDATE public.applications SET status='acceptee' WHERE id=$1 RETURNING id",[cases.a])).rows).toHaveLength(0)
    })
  })
  it('refuse à un étudiant de modifier ses propres rôles', async () => {
    await expect(asUser(users.studentA, sql => sql.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'super_admin')",[users.studentA]))).rejects.toThrow()
  })
  it('autorise la création de son propre dossier mais refuse les attributions arbitraires', async () => {
    await asUser(users.studentA, async sql => {
      const result=await sql.query("INSERT INTO public.applications(student_id,title) VALUES ($1,'Mon dossier') RETURNING student_id,status,assigned_advisor",[users.studentA])
      expect(result.rows[0]).toMatchObject({student_id:users.studentA,status:'recu',assigned_advisor:null})
    })
    await expect(asUser(users.studentA,sql=>sql.query("INSERT INTO public.applications(student_id,title,assigned_advisor) VALUES ($1,'Dossier forcé',$2)",[users.studentA,users.advisorA]))).rejects.toThrow()
    await expect(asUser(users.studentA,sql=>sql.query("INSERT INTO public.applications(student_id,title) VALUES ($1,'Dossier étranger')",[users.studentB]))).rejects.toThrow()
  })
  it('ne permet pas à un administrateur de s’attribuer le rôle super administrateur', async () => {
    await expect(asUser(users.admin,sql=>sql.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'super_admin')",[users.admin]))).rejects.toThrow()
    await expect(asUser(users.superAdmin,sql=>sql.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'academic_advisor')",[users.superAdmin]))).rejects.toThrow()
  })
  it('réserve le répertoire des utilisateurs au super administrateur et utilise Auth pour l’e-mail', async () => {
    await asUser(users.studentA,async sql=>expect(sql.query("SELECT * FROM public.admin_list_users('',0)")).rejects.toThrow())
    await asUser(users.superAdmin,async sql=>{
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.studentA])
      await sql.query("UPDATE public.profiles SET email='faux@example.invalid' WHERE id=$1",[users.studentA])
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.superAdmin])
      const result=await sql.query("SELECT * FROM public.admin_list_users('studentA',0)")
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]).toMatchObject({id:users.studentA,email:'studentA@example.invalid',email_confirmed:true,roles:['student']})
    })
    await expect(asUser(users.admin,sql=>sql.query("SELECT * FROM public.admin_list_users('',0)"))).rejects.toThrow()
    await expect(asAnonymous(sql=>sql.query("SELECT * FROM public.admin_list_users('',0)"))).rejects.toThrow()
  })
  it('réserve la modification auditée des rôles au super administrateur', async () => {
    await asUser(users.superAdmin,async sql=>{
      await sql.query("SELECT public.admin_set_user_role($1,'academic_advisor',true)",[users.studentA])
      expect((await sql.query('SELECT role FROM public.user_roles WHERE user_id=$1 ORDER BY role',[users.studentA])).rows.map(x=>x.role)).toEqual(['academic_advisor','student'])
      const audit=await sql.query("SELECT action,entity_id FROM public.activity_logs WHERE entity='user_role'")
      expect(audit.rows).toEqual([{action:'role_grant:academic_advisor',entity_id:users.studentA}])
      await sql.query("SELECT public.admin_set_user_role($1,'academic_advisor',false)",[users.studentA])
      expect((await sql.query("SELECT action FROM public.activity_logs WHERE action='role_revoke:academic_advisor'")).rows).toHaveLength(1)
    })
    await expect(asUser(users.admin,sql=>sql.query("SELECT public.admin_set_user_role($1,'admin',true)",[users.studentA]))).rejects.toThrow()
    await expect(asUser(users.studentA,sql=>sql.query("SELECT public.admin_set_user_role($1,'admin',true)",[users.studentA]))).rejects.toThrow()
    await expect(asUser(users.superAdmin,sql=>sql.query("SELECT public.admin_set_user_role($1,'admin',true)",[users.superAdmin]))).rejects.toThrow()
    await expect(asUser(users.superAdmin,sql=>sql.query("SELECT public.admin_set_user_role($1,'super_admin',true)",[users.studentA]))).rejects.toThrow()
    await expect(asUser(users.superAdmin,sql=>sql.query("SELECT public.admin_set_user_role($1,'student',false)",[users.studentA]))).rejects.toThrow()
    await expect(asUser(users.superAdmin,sql=>sql.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'admin')",[users.studentA]))).rejects.toThrow()
    await expect(asUser(users.superAdmin,sql=>sql.query("DELETE FROM public.user_roles WHERE user_id=$1",[users.studentA]))).rejects.toThrow()
    await expect(asAnonymous(sql=>sql.query("SELECT public.admin_set_user_role($1,'admin',true)",[users.studentA]))).rejects.toThrow()
  })
  it('refuse une promotion non confirmée et la révocation d’un conseiller ayant des dossiers', async () => {
    await db.query('UPDATE auth.users SET email_confirmed_at=null WHERE id=$1',[users.studentB])
    try { await expect(asUser(users.superAdmin,sql=>sql.query("SELECT public.admin_set_user_role($1,'admin',true)",[users.studentB]))).rejects.toThrow() }
    finally {await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[users.studentB])}
    await expect(asUser(users.superAdmin,sql=>sql.query("SELECT public.admin_set_user_role($1,'academic_advisor',false)",[users.advisorA]))).rejects.toThrow()
    await asUser(users.superAdmin,async sql=>{
      await sql.query('SELECT public.assign_application_advisor($1,null)',[cases.a])
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.studentA])
      await sql.query("INSERT INTO public.orientation_requests(student_id) VALUES ($1)",[users.studentA])
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.superAdmin])
      await sql.query("UPDATE public.orientation_requests SET assigned_advisor=$1 WHERE student_id=$2",[users.advisorA,users.studentA])
      await expect(sql.query("SELECT public.admin_set_user_role($1,'academic_advisor',false)",[users.advisorA])).rejects.toThrow()
    })
    await asUser(users.superAdmin,async sql=>{
      await sql.query('SELECT public.assign_application_advisor($1,null)',[cases.a])
      await sql.query("SELECT public.admin_set_user_role($1,'academic_advisor',false)",[users.advisorA])
      expect((await sql.query('SELECT role FROM public.user_roles WHERE user_id=$1',[users.advisorA])).rows.map(x=>x.role)).toEqual(['student'])
    })
  })
  it('autorise uniquement les profils des étudiants attribués au conseiller', async () => {
    await asUser(users.advisorA,async sql => {
      const rows=await sql.query('SELECT id FROM public.profiles WHERE id IN ($1,$2)',[users.studentA,users.studentB])
      expect(rows.rows.map(row=>row.id)).toEqual([users.studentA])
    })
  })
  it('limite les conseillers aux dossiers qui leur sont attribués', async () => {
    await asUser(users.advisorA, async sql => {
      expect((await sql.query('SELECT id FROM public.applications')).rows.map(x=>x.id)).toEqual([cases.a])
      expect((await sql.query('SELECT id FROM public.application_notes')).rows).toHaveLength(1)
      await sql.query("SELECT public.update_application_status($1,'en_etude')",[cases.a])
      expect((await sql.query('SELECT status FROM public.applications WHERE id=$1',[cases.a])).rows[0].status).toBe('en_etude')
    })
    await expect(asUser(users.advisorA, sql=>sql.query("SELECT public.update_application_status($1,'acceptee')",[cases.b]))).rejects.toThrow()
    await expect(asUser(users.advisorA, sql=>sql.query("INSERT INTO public.application_notes(application_id,author_id,content) VALUES ($1,$2,'Refus')",[cases.b,users.advisorA]))).rejects.toThrow()
  })
  it('permet seulement aux administrateurs d’attribuer un conseiller valide', async () => {
    await asUser(users.admin, async sql => {
      await sql.query('SELECT public.assign_application_advisor($1,$2)',[cases.a,users.advisorB])
      expect((await sql.query('SELECT assigned_advisor FROM public.applications WHERE id=$1',[cases.a])).rows[0].assigned_advisor).toBe(users.advisorB)
    })
    await expect(asUser(users.advisorA, sql=>sql.query('SELECT public.assign_application_advisor($1,$2)',[cases.a,users.advisorA]))).rejects.toThrow()
    await expect(asUser(users.admin, sql=>sql.query('SELECT public.assign_application_advisor($1,$2)',[cases.a,users.studentB]))).rejects.toThrow()
  })
  it('autorise les échanges uniquement entre les participants du dossier attribué', async () => {
    await asUser(users.studentA,async sql=>{
      expect((await sql.query('SELECT content FROM public.messages')).rows.map(x=>x.content)).toEqual(['Message A'])
      await sql.query("INSERT INTO public.messages(application_id,sender_id,receiver_id,content) VALUES ($1,$2,$3,'Bonjour')",[cases.a,users.studentA,users.advisorA])
    })
    await asUser(users.advisorA,async sql=>{
      expect((await sql.query('SELECT content FROM public.messages')).rows.map(x=>x.content)).toEqual(['Message A'])
      await sql.query("INSERT INTO public.messages(application_id,sender_id,receiver_id,content) VALUES ($1,$2,$3,'Réponse')",[cases.a,users.advisorA,users.studentA])
    })
    await expect(asUser(users.studentA,sql=>sql.query("INSERT INTO public.messages(application_id,sender_id,receiver_id,content) VALUES ($1,$2,$3,'Fausse cible')",[cases.a,users.studentA,users.advisorB]))).rejects.toThrow()
    await expect(asUser(users.advisorB,sql=>sql.query("INSERT INTO public.messages(application_id,sender_id,receiver_id,content) VALUES ($1,$2,$3,'Autre dossier')",[cases.a,users.advisorB,users.studentA]))).rejects.toThrow()
    await expect(asUser(users.studentA,sql=>sql.query("INSERT INTO public.messages(application_id,sender_id,receiver_id,content) VALUES ($1,$2,$3,'Usurpation')",[cases.a,users.advisorA,users.studentA]))).rejects.toThrow()
  })
  it('crée une notification privée et protège les accusés de lecture', async () => {
    await asUser(users.advisorA,async sql=>{
      const notices=await sql.query('SELECT * FROM public.notifications')
      expect(notices.rows).toHaveLength(1)
      expect(notices.rows[0].user_id).toBe(users.advisorA)
      await sql.query('SELECT public.mark_application_messages_read($1)',[cases.a])
      expect((await sql.query('SELECT read_at FROM public.messages WHERE application_id=$1',[cases.a])).rows[0].read_at).not.toBeNull()
      await sql.query('SELECT public.mark_notification_read($1)',[notices.rows[0].id])
      expect((await sql.query('SELECT read_at FROM public.notifications WHERE id=$1',[notices.rows[0].id])).rows[0].read_at).not.toBeNull()
    })
    await asUser(users.studentA,async sql=>expect((await sql.query('SELECT * FROM public.notifications')).rows).toHaveLength(0))
    await expect(asUser(users.studentA,sql=>sql.query('SELECT public.mark_application_messages_read($1)',[cases.b]))).rejects.toThrow()
    await expect(asUser(users.studentA,sql=>sql.query("INSERT INTO public.notifications(user_id,title,message) VALUES ($1,'x','x')",[users.studentA]))).rejects.toThrow()
    await expect(asUser(users.studentA,sql=>sql.query('UPDATE public.messages SET read_at=now()'))).rejects.toThrow()
  })
  it('notifie le changement de statut et l’attribution sans notification si rien ne change', async () => {
    await asUser(users.admin,async sql=>{
      await sql.query("SELECT public.update_application_status($1,'en_etude')",[cases.a])
      await sql.query('SELECT public.assign_application_advisor($1,$2)',[cases.a,users.advisorB])
      await sql.query('SELECT public.assign_application_advisor($1,$2)',[cases.a,users.advisorB])
      // L'administrateur n'a pas accès aux notifications privées des autres utilisateurs.
      expect((await sql.query('SELECT * FROM public.notifications')).rows).toHaveLength(0)
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.studentA])
      const student=await sql.query('SELECT type FROM public.notifications ORDER BY type')
      expect(student.rows.map(x=>x.type)).toEqual(['assignment','status'])
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.advisorB])
      const advisor=await sql.query("SELECT type FROM public.notifications WHERE application_id=$1",[cases.a])
      expect(advisor.rows.map(x=>x.type)).toEqual(['assignment'])
    })
  })
  it('retire au conseiller précédent l’accès à la conversation après réattribution', async () => {
    await asUser(users.admin,async sql=>{
      await sql.query('SELECT public.assign_application_advisor($1,$2)',[cases.a,users.advisorB])
      // L'opération est annulée à la fin du test ; on vérifie le nouveau lien en base.
      expect((await sql.query('SELECT assigned_advisor FROM public.applications WHERE id=$1',[cases.a])).rows[0].assigned_advisor).toBe(users.advisorB)
    })
    // Utiliser une transaction pour changer l'identité sans réinitialiser l'attribution.
    await db.exec('BEGIN')
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.admin]);await db.exec('SET LOCAL ROLE authenticated')
      await db.query('SELECT public.assign_application_advisor($1,$2)',[cases.a,users.advisorB])
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[users.advisorA])
      expect((await db.query('SELECT id FROM public.messages WHERE application_id=$1',[cases.a])).rows).toHaveLength(0)
      await expect(db.query("INSERT INTO public.messages(application_id,sender_id,receiver_id,content) VALUES ($1,$2,$3,'Ancien conseiller')",[cases.a,users.advisorA,users.studentA])).rejects.toThrow()
    } finally { await db.exec('ROLLBACK') }
  })
  it('isole les objets Storage par dossier propriétaire', async () => {
    await asUser(users.studentA, async sql=>{
      const rows=await sql.query('SELECT name FROM storage.objects')
      expect(rows.rows.map(x=>x.name)).toEqual([`${users.studentA}/a.pdf`])
      expect((await sql.query('DELETE FROM storage.objects WHERE name=$1 RETURNING name',[`${users.studentB}/b.pdf`])).rows).toHaveLength(0)
    })
    await expect(asUser(users.studentA,sql=>sql.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('student-documents',$1)",[`${users.studentB}/other.pdf`]))).rejects.toThrow()
    await asUser(users.advisorA,async sql=>expect((await sql.query('SELECT name FROM storage.objects')).rows).toHaveLength(0))
  })
  it('refuse les fonctions de gestion aux visiteurs anonymes', async () => {
    await expect(asAnonymous(sql=>sql.query('SELECT public.list_academic_advisors()'))).rejects.toThrow()
    await expect(asAnonymous(sql=>sql.query("SELECT public.update_application_status($1,'acceptee')",[cases.a]))).rejects.toThrow()
  })
  it('ne donne pas accès aux dossiers privés aux visiteurs anonymes', async () => {
    await asAnonymous(async sql=>expect((await sql.query('SELECT id FROM public.applications')).rows).toHaveLength(0))
  })
})
