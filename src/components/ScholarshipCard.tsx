import { Link } from 'react-router-dom'
import { ArrowUpRight, MapPin, CalendarDays } from 'lucide-react'
import { deadlineLabel, type Scholarship } from '../types'
export function ScholarshipCard({item}:{item:Scholarship}){return <article className="scholar-card"><div className="scholar-top"><span className="chip">{item.funding_type||'Bourse d’études'}</span><ArrowUpRight size={19}/></div><h3><Link to={'/bourses/'+item.slug}>{item.title}</Link></h3><p>{item.institution||'Organisme à consulter'}</p><div className="scholar-meta"><span><MapPin size={15}/> {item.country||'Pays à préciser'}</span><span><CalendarDays size={15}/> {deadlineLabel(item.deadline)}</span></div><Link className="text-link" to={'/bourses/'+item.slug}>Voir l’opportunité <ArrowUpRight size={15}/></Link></article>}
