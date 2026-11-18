import { describe, expect, it } from 'vitest'
import { initialState, sampleParts, samplePartRows, today, addDays } from '../src/shared/sample'
import {
  compareAll, draftPos, draftRfqs, findSuppliers, needsHead, newRequest, partsFromRows, partsFromText, readQuoteMail, simulateReply, uid
} from '../src/shared/logic'
import type { Mail } from '../src/shared/types'

describe('part list intake', () => {
  it('reads Thai headers and fills standard prices from the item master', () => {
    const r = partsFromRows(samplePartRows(), addDays(today(), 14))
    expect(r.parts).toHaveLength(6)
    expect(r.parts[0]).toMatchObject({ partNo: 'BRG-6204ZZ', qty: 500, standardPrice: 38, category: 'bearing' })
    expect(r.warnings).toHaveLength(0)
  })
  it('parses pasted lines', () => {
    const r = partsFromText('BRG-6204ZZ, bearing, 100, pcs\nORG-NBR-40X3, o-ring, 50, pcs', today())
    expect(r.parts.map((p) => p.qty)).toEqual([100, 50])
  })
})

describe('end-to-end sourcing flow', () => {
  it('finds suppliers, reads simulated quotes, picks, flags the band and drafts POs', () => {
    const s = initialState()
    const req = newRequest(s, 'test', sampleParts())
    req.candidates = findSuppliers(req, s.suppliers)
    for (const p of req.parts) expect(req.candidates[p.id].length).toBeGreaterThanOrEqual(3)
    req.rfqs = draftRfqs(req, s.suppliers, s.settings)
    expect(req.rfqs.length).toBeGreaterThan(5)
    for (const rfq of req.rfqs) {
      const sup = s.suppliers.find((x) => x.id === rfq.supplierId)!
      const mail: Mail = { id: uid('m'), direction: 'in', supplierId: sup.id, requestId: req.id, rfqId: rfq.id, subject: 'RE', body: simulateReply(sup, rfq, req), at: new Date().toISOString(), delivered: true }
      const qs = readQuoteMail(mail, rfq, req)
      expect(qs.length, `quotes parsed from ${sup.name}`).toBe(rfq.partIds.length)
      for (const q of qs) expect(q.unitPrice).toBeGreaterThan(0)
      req.quotes.push(...qs)
    }
    req.picks = compareAll(req, s.suppliers, s.settings)
    expect(req.picks).toHaveLength(6)
    const steel = req.parts.find((p) => p.partNo === 'SHT-SPCC-1.2')!
    const steelPick = req.picks.find((p) => p.partId === steel.id)!
    // The cheaper steel supplier misses the need-by date, so the pick is the on-time one above the band.
    expect(s.suppliers.find((x) => x.id === steelPick.supplierId)!.id).toBe('sup-samut')
    expect(steelPick.band).toBe('above')
    expect(needsHead(req)).toBe(true)
    const pos = draftPos(req, s)
    expect(pos.length).toBeGreaterThan(0)
    for (const po of pos) expect(po.total).toBeCloseTo(po.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0), 2)
  })
})
