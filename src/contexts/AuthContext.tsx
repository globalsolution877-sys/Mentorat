import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
type State={session:Session|null;roles:string[];loading:boolean}
const AuthContext=createContext<State>({session:null,roles:[],loading:true})
export function AuthProvider({children}:{children:ReactNode}){
 const [session,setSession]=useState<Session|null>(null); const [roles,setRoles]=useState<string[]>([]); const [loading,setLoading]=useState(true)
 useEffect(()=>{let active=true; let revision=0
  const apply=async(s:Session|null)=>{const current=++revision; if(!active)return; setSession(s);setRoles([]); if(s){const {data}=await supabase.from('user_roles').select('role').eq('user_id',s.user.id);if(active && current===revision)setRoles((data||[]).map(x=>x.role))} if(active && current===revision)setLoading(false)}
  supabase.auth.getSession().then(({data})=>apply(data.session));const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{setTimeout(()=>void apply(s),0)})
  return()=>{active=false;subscription.unsubscribe()}
 },[])
 return <AuthContext.Provider value={{session,roles,loading}}>{children}</AuthContext.Provider>
}
export const useAuth=()=>useContext(AuthContext)
