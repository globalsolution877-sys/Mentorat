export const MAX_DOCUMENT_BYTES=5*1024*1024
export const allowedTypes:Record<string,string>={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'}
export async function validateDocument(file:File):Promise<string|null> {
  if(file.size===0||file.size>MAX_DOCUMENT_BYTES) return 'Choisissez un fichier non vide de 5 Mo maximum.'
  if(!allowedTypes[file.type]) return 'Formats autorisés : PDF, JPEG et PNG.'
  const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer())
  const match=file.type==='application/pdf'?bytes.length>=5&&bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d:file.type==='image/jpeg'?bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff:bytes.length===8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((x,i)=>bytes[i]===x)
  return match?null:'Le contenu du fichier ne correspond pas au format indiqué.'
}
export function documentFilename(file:File):string {
  const name=file.name.replace(/\.[^.]+$/,'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'document'
  return `${crypto.randomUUID()}_${name}.${allowedTypes[file.type]}`
}
