import { describe,it,expect,vi,afterEach } from 'vitest'
import { deadlineLabel,safeUrl } from './index'
describe('liens externes',()=>{it('refuse les protocoles dangereux',()=>{expect(safeUrl('javascript:alert(1)')).toBeNull();expect(safeUrl('data:text/html,test')).toBeNull()});it('autorise une URL HTTPS',()=>expect(safeUrl('https://example.org/path')).toBe('https://example.org/path'))})
describe('date limite',()=>{afterEach(()=>vi.useRealTimers());it('distingue les échéances dépassées',()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-02T12:00:00'));expect(deadlineLabel('2026-01-01')).toBe('Date limite dépassée');expect(deadlineLabel(null)).toBe('Date à vérifier')})})
