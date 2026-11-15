export const statuses = {
  recu:'Reçu', en_etude:'En étude', informations_demandees:'Informations complémentaires demandées',
  en_accompagnement:'En accompagnement', candidature_preparee:'Candidature préparée',
  soumise:'Soumise', acceptee:'Acceptée', refusee:'Refusée', cloturee:'Clôturée'
} as const
export type ApplicationStatus = keyof typeof statuses
export type Application = { id:string; student_id:string; scholarship_id:string|null; title:string; assigned_advisor:string|null; status:ApplicationStatus; created_at:string; updated_at:string }
export type ApplicationNote = { id:string; application_id:string; author_id:string; content:string; created_at:string }
