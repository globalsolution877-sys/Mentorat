import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

const roleLabels: Record<string,string> = {
 student:'Étudiant', super_admin:'Super administrateur', admin:'Administrateur',
 academic_advisor:'Conseiller académique', scholarship_manager:'Gestionnaire des bourses',
 editor:'Éditeur', application_manager:'Gestionnaire des candidatures', visa_manager:'Gestionnaire des visas', training_manager:'Gestionnaire des formations',
}
const managedRoles=['admin','academic_advisor','scholarship_manager','editor','application_manager','visa_manager','training_manager']
type UserRow={id:string;full_name:string;email:string;email_confirmed:boolean;created_at:string;roles:string[]}
const pageSize=25
export function UserManagement(){
 const {session,roles,loading}=useAuth()
 const permitted=roles.includes('super_admin')
 const [query,setQuery]=useState('');const [search,setSearch]=useState('');const [page,setPage]=useState(0)
 const [users,setUsers]=useState<UserRow[]>([]);const [more,setMore]=useState(false);const [fetching,setFetching]=useState(true);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [revision,setRevision]=useState(0)
 useEffect(()=>{if(!permitted)return;let active=true;setFetching(true);setNotice('');supabase.rpc('admin_list_users',{search_text:search,page_offset:page*pageSize}).then(({data,error})=>{if(!active)return;if(error){setUsers([]);setMore(false);setNotice('Impossible de charger les utilisateurs. Vérifiez vos autorisations et réessayez.')}else{const rows:UserRow[]=data||[];setUsers(rows.slice(0,pageSize));setMore(rows.length>pageSize)}setFetching(false)});return()=>{active=false}},[permitted,search,page,revision])
 function searchUsers(e:FormEvent){e.preventDefault();setPage(0);setSearch(query.trim());setRevision(r=>r+1)}
 async function changeRole(user:UserRow,role:string,grant:boolean){
  const label=roleLabels[role];const action=grant?'attribuer':'retirer'
  if(!window.confirm(`Confirmer : ${action} le rôle « ${label} » ${grant?'à':'de'} ${user.email||user.full_name||'cet utilisateur'} ?`))return
  setBusy(true);setNotice('')
  const {error}=await supabase.rpc('admin_set_user_role',{target_user:user.id,target_role:role,grant_role:grant})
  if(error){if(error.message.includes('Réattribuez'))setNotice('Réattribuez d’abord tous les dossiers et demandes d’orientation de ce conseiller.');else if(error.message.includes('non confirmé'))setNotice('Ce compte doit confirmer son e-mail avant de recevoir un rôle.');else setNotice('Modification impossible. Actualisez la liste et vérifiez les autorisations.')}
  else {setNotice('Rôle mis à jour et inscrit dans le journal.');setUsers(old=>old.map(row=>row.id===user.id?{...row,roles:grant?[...row.roles,role]:row.roles.filter(r=>r!==role)}:row))}
  setBusy(false)
 }
 if(loading)return <div className="container section">Chargement…</div>
 if(!permitted)return <div className="container section"><h1>Accès non autorisé</h1><p>Seul un super administrateur peut gérer les rôles.</p><Link to="/espace">Retour à mon espace</Link></div>
 return <section className="container section user-admin"><div className="eyebrow"><span/> SUPER ADMINISTRATION</div><h1>Utilisateurs et rôles</h1><p>Recherchez un compte existant et gérez ses rôles. Seuls les comptes dont l’e-mail est confirmé peuvent recevoir un rôle.</p><p className="security-note">Les rôles donnent accès à des données privées. Vérifiez l’identité et l’adresse e-mail avant toute attribution. Certains modules associés aux rôles ne sont pas encore disponibles.</p><div className="detail-actions"><Link className="button button-light" to="/espace">Mon espace</Link><Link className="button button-light" to="/admin">Gestion des bourses</Link><Link className="button button-light" to="/dossiers">Suivi des dossiers</Link></div><form className="user-search" onSubmit={searchUsers}><label>Rechercher par nom ou e-mail<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={200} placeholder="Nom ou adresse e-mail"/></label><button className="button button-blue" disabled={busy}>Rechercher</button></form>{notice&&<p className="notice" role="status">{notice}</p>}{fetching?<div className="empty">Chargement…</div>:users.length?<div className="user-list">{users.map(user=><article className="user-card" key={user.id}><div><h2>{user.full_name||'Nom non renseigné'} {user.id===session?.user.id&&<small>(vous)</small>}</h2><p>{user.email||'E-mail non renseigné'} · {user.email_confirmed?'E-mail confirmé':'E-mail non confirmé'}</p><small>Inscrit le {new Date(user.created_at).toLocaleDateString('fr-FR')}</small></div><p><strong>Rôles actuels :</strong> {user.roles.length?user.roles.map(r=>roleLabels[r]||r).join(', '):'Aucun'}</p>{user.id===session?.user.id?<p>Vous ne pouvez pas modifier vos propres rôles.</p>:<div className="role-actions">{managedRoles.map(role=>{const active=user.roles.includes(role);return <div className="role-row" key={role}><span>{roleLabels[role]}</span><button type="button" className="button button-light" disabled={busy||(!active&&!user.email_confirmed)} onClick={()=>void changeRole(user,role,!active)}>{active?'Retirer':'Attribuer'}</button></div>})}</div>}</article>)}</div>:<div className="empty">Aucun utilisateur trouvé.</div>}<div className="user-pagination"><button className="button button-light" disabled={fetching||busy||page===0} onClick={()=>setPage(p=>p-1)}>Précédent</button><span>Page {page+1}</span><button className="button button-light" disabled={fetching||busy||!more} onClick={()=>setPage(p=>p+1)}>Suivant</button></div><p>Le rôle étudiant et le rôle super administrateur ne sont pas modifiables ici. L’initialisation et la gestion des super administrateurs nécessitent une opération SQL de confiance.</p></section>
}
