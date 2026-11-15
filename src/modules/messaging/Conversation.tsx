import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Application } from '../applications/types'

type Message = { id:string; sender_id:string; receiver_id:string; content:string; created_at:string; read_at:string|null }
export function Conversation({application,userId}:{application:Application;userId:string}) {
 const [messages,setMessages]=useState<Message[]>([]); const [text,setText]=useState(''); const [notice,setNotice]=useState(''); const [busy,setBusy]=useState(false); const [loading,setLoading]=useState(true)
 const recipient=application.student_id===userId?application.assigned_advisor:application.assigned_advisor===userId?application.student_id:null
 useEffect(()=>{
  let live=true
  async function load(){const {data,error}=await supabase.from('messages').select('id,sender_id,receiver_id,content,created_at,read_at').eq('application_id',application.id).order('created_at');if(live){if(error)setNotice('Impossible de charger les messages.');else setMessages(data||[]);setLoading(false)} }
  async function refresh(){await load();if(recipient){const {error}=await supabase.rpc('mark_application_messages_read',{app_id:application.id});if(error&&live)setNotice('Impossible de marquer les messages comme lus.') }}
  setMessages([]);setText('');setNotice('');setLoading(true);void refresh()
  const channel=supabase.channel(`messages:${application.id}:${userId}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`application_id=eq.${application.id}`},()=>{void refresh()}).subscribe(status=>{if(live&&(status==='CHANNEL_ERROR'||status==='TIMED_OUT'))setNotice('Actualisation en temps réel indisponible. Rouvrez le dossier pour actualiser.')})
  return()=>{live=false;void supabase.removeChannel(channel)}
 },[application.id,recipient,userId])
 async function send(e:FormEvent){e.preventDefault();if(!recipient||!text.trim())return;setBusy(true);setNotice('');const {error}=await supabase.from('messages').insert({application_id:application.id,sender_id:userId,receiver_id:recipient,content:text.trim()});if(error)setNotice('Envoi impossible. Vérifiez que le conseiller est toujours attribué à ce dossier.');else{setText('');const {data,error:readError}=await supabase.from('messages').select('id,sender_id,receiver_id,content,created_at,read_at').eq('application_id',application.id).order('created_at');if(readError)setNotice('Message envoyé, mais actualisation impossible.');else setMessages(data||[])}setBusy(false)}
 return <section className="conversation"><h3>Messagerie du dossier</h3><p>Les administrateurs peuvent consulter les échanges. Évitez d’y transmettre des documents sensibles.</p>{loading?<p>Chargement…</p>:messages.length?<div className="message-list">{messages.map(m=><article className={'message '+(m.sender_id===userId?'mine':'')} key={m.id}><small>{m.sender_id===userId?'Vous':'Interlocuteur'} · {new Date(m.created_at).toLocaleString('fr-FR')}</small><p>{m.content}</p></article>)}</div>:<p>Aucun message pour ce dossier.</p>}{recipient?<form className="form" onSubmit={send}><label>Votre message<textarea value={text} onChange={e=>setText(e.target.value)} required maxLength={5000} rows={3}/></label><button className="button button-blue" disabled={busy||!text.trim()}>{busy?'Envoi…':'Envoyer'}</button></form>:<p>La messagerie est disponible entre l’étudiant et le conseiller actuellement attribué.</p>}{notice&&<p role="status" className="notice">{notice}</p>}</section>
}
