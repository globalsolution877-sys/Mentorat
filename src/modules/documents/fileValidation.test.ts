import { describe,expect,it } from 'vitest'
import { MAX_DOCUMENT_BYTES, validateDocument } from './fileValidation'
describe('validation des documents',()=>{
 it('accepte une signature PDF valide',async()=>expect(await validateDocument(new File(['%PDF-1.7\n'],'cv.pdf',{type:'application/pdf'}))).toBeNull())
 it('refuse un fichier dont la signature ne correspond pas au MIME',async()=>expect(await validateDocument(new File(['<html>'],'cv.pdf',{type:'application/pdf'}))).toMatch(/ne correspond pas/))
 it('refuse les types non pris en charge',async()=>expect(await validateDocument(new File(['hello'],'note.txt',{type:'text/plain'}))).toMatch(/Formats autorisés/))
 it('refuse un fichier dépassant la limite',async()=>expect(await validateDocument(new File([new Uint8Array(MAX_DOCUMENT_BYTES+1)],'grand.pdf',{type:'application/pdf'}))).toMatch(/5 Mo/))
})
