// Pure purchasing logic: parsing, sourcing, RFQs, quote reading, comparison, PO drafting.
// Shared by the main process (agent tools) and tests. No Electron or DOM imports.
import type {
  AppState, Bi, FactorReason, Lang, Mail, Part, Pick, PurchaseOrder, PurchaseRequest, Quote, Rfq, Settings, Supplier
} from './types'
import { ITEM_MASTER, addDays } from './sample'

export const bi = (th: string, en: string): Bi => ({ th, en })
export const pickLang = (b: Bi, lang: Lang): string => b[lang]

let counter = 0
export function uid(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

export const now = (): string => new Date().toISOString()

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 864e5)
}

/** Deterministic 0..1 hash so simulated quotes are stable between runs. */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

// ---------------------------------------------------------------- part list intake

const HEADER_MAP: Record<keyof Omit<Part, 'id' | 'category'>, RegExp> = {
  partNo: /^(part\s*no|part\s*number|p\/?n|item\s*code|code|รหัส|รหัสชิ้นส่วน|รหัสสินค้า)/i,
  name: /^(name|description|item|part\s*name|รายการ|ชื่อ|ชื่อสินค้า|ชื่อชิ้นส่วน)/i,
  spec: /^(spec|specification|detail|สเปค|สเปก|รายละเอียด|ข้อกำหนด)/i,
  qty: /^(qty|quantity|amount|จำนวน)/i,
  unit: /^(unit|uom|หน่วย)/i,
  needBy: /^(need\s*by|required|due|date|delivery|วันที่ต้องการ|กำหนดส่ง|วันที่)/i,
  standardPrice: /^(std|standard|target|ราคากลาง|ราคามาตรฐาน)/i
}

export interface ParseResult {
  parts: Part[]
  warnings: Bi[]
}

/** Turn spreadsheet rows (first row = headers) into parts. Tolerates Thai or English headers. */
export function partsFromRows(rows: (string | number | null | undefined)[][], defaultNeedBy: string): ParseResult {
  const warnings: Bi[] = []
  const clean = rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())))
  const nonEmpty = clean.filter((r) => r.some((c) => c !== ''))
  if (nonEmpty.length === 0) return { parts: [], warnings: [bi('ไฟล์ว่าง', 'The file is empty')] }
  const headerIdx = nonEmpty.findIndex((r) => r.some((c) => HEADER_MAP.partNo.test(c) || HEADER_MAP.qty.test(c)))
  const header = headerIdx >= 0 ? nonEmpty[headerIdx] : []
  const body = headerIdx >= 0 ? nonEmpty.slice(headerIdx + 1) : nonEmpty
  const col: Partial<Record<keyof typeof HEADER_MAP, number>> = {}
  header.forEach((h, i) => {
    for (const k of Object.keys(HEADER_MAP) as (keyof typeof HEADER_MAP)[]) {
      if (col[k] === undefined && HEADER_MAP[k].test(h)) {
        col[k] = i
        break
      }
    }
  })
  if (headerIdx < 0) {
    // No header: assume partNo, name, qty, unit
    Object.assign(col, { partNo: 0, name: 1, qty: 2, unit: 3 })
    warnings.push(bi('ไม่พบหัวตาราง ใช้ลำดับคอลัมน์ รหัส, รายการ, จำนวน, หน่วย', 'No header row found; assumed columns code, name, qty, unit'))
  }
  const parts: Part[] = []
  body.forEach((r, i) => {
    const get = (k: keyof typeof HEADER_MAP) => (col[k] !== undefined ? r[col[k]!] ?? '' : '')
    const partNo = get('partNo').toUpperCase()
    const qty = parseNumber(get('qty'))
    if (!partNo && !get('name')) return
    if (!qty) warnings.push(bi(`แถว ${i + 1}: ไม่มีจำนวน`, `Row ${i + 1}: quantity missing`))
    const master = ITEM_MASTER[partNo]
    const std = parseNumber(get('standardPrice')) || master?.standardPrice
    parts.push({
      id: uid('part'),
      partNo: partNo || `ITEM-${i + 1}`,
      name: get('name') || partNo,
      spec: get('spec'),
      qty: qty || 0,
      unit: get('unit') || 'pcs',
      needBy: normaliseDate(get('needBy')) || defaultNeedBy,
      standardPrice: std || undefined,
      category: master?.category ?? guessCategory(`${partNo} ${get('name')} ${get('spec')}`)
    })
    if (!std) warnings.push(bi(`${partNo || 'แถว ' + (i + 1)}: ไม่มีราคากลาง`, `${partNo || 'Row ' + (i + 1)}: no standard price`))
  })
  return { parts, warnings }
}

/** Parse pasted text such as "BRG-6204ZZ ตลับลูกปืน 500 pcs" one item per line. */
export function partsFromText(text: string, defaultNeedBy: string): ParseResult {
  const rows: string[][] = [['code', 'name', 'qty', 'unit']]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const cells = line.includes('\t') ? line.split('\t') : line.includes(',') ? line.split(',') : null
    if (cells && cells.length >= 3) {
      rows.push(cells.map((c) => c.trim()))
      continue
    }
    const m = line.match(/^([A-Za-z0-9][\w.\-/]*)\s+(.*?)\s+([\d,.]+)\s*([^\d\s]+)?$/)
    if (m) rows.push([m[1], m[2], m[3], m[4] ?? 'pcs'])
  }
  return partsFromRows(rows, defaultNeedBy)
}

export function parseNumber(s: string): number {
  const n = Number(String(s).replace(/[,\s฿]|THB|บาท/gi, ''))
  return Number.isFinite(n) ? n : 0
}

function normaliseDate(s: string): string | '' {
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    let y = Number(m[3])
    if (y < 100) y += 2000
    if (y > 2400) y -= 543 // Buddhist era
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export function guessCategory(text: string): string {
  const t = text.toLowerCase()
  if (/bearing|ลูกปืน/.test(t)) return 'bearing'
  if (/bolt|nut|screw|สกรู|น็อต|washer/.test(t)) return 'fastener'
  if (/steel|sheet|เหล็ก|spcc|plate/.test(t)) return 'steel'
  if (/o-?ring|rubber|seal|ยาง|โอริง/.test(t)) return 'rubber'
  if (/paint|powder|coat|สี/.test(t)) return 'paint'
  if (/cable|wire|สายไฟ|vct|thw/.test(t)) return 'electrical'
  return 'general'
}

// ---------------------------------------------------------------- requests

export function newRequest(state: AppState, title: string, parts: Part[]): PurchaseRequest {
  state.seq.request += 1
  const needBy = parts.map((p) => p.needBy).sort()[0] ?? addDays(now(), 14)
  return {
    id: `PR-${new Date().getFullYear()}-${String(state.seq.request).padStart(4, '0')}`,
    title,
    createdAt: now(),
    needBy,
    status: 'new',
    parts,
    candidates: {},
    rfqs: [],
    quotes: [],
    picks: [],
    approval: 'none',
    pos: [],
    chat: [],
    log: []
  }
}

export function log(req: PurchaseRequest, who: 'agent' | 'buyer' | 'head' | 'system', text: Bi): void {
  req.log.push({ at: now(), who, text })
}

// ---------------------------------------------------------------- supplier search

/**
 * Pick candidate suppliers per part: the company's own suppliers first, then search leads,
 * until there are at least `min` per part. Spot-market sellers are only added when the
 * need-by date is closer than every other supplier's lead time.
 */
export function findSuppliers(req: PurchaseRequest, suppliers: Supplier[], min = 3): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const part of req.parts) {
    const daysLeft = daysBetween(now(), part.needBy)
    const fits = suppliers.filter((s) => s.categories.includes(part.category ?? 'general'))
    const regular = fits.filter((s) => s.id !== 'sup-spot')
    const ranked = [
      ...regular.filter((s) => s.known),
      ...regular.filter((s) => !s.known)
    ]
    const chosen = ranked.slice(0, Math.max(min, ranked.filter((s) => s.known).length))
    const spot = fits.find((s) => s.id === 'sup-spot')
    const urgent = chosen.every((s) => s.profile.leadDays > daysLeft)
    if (spot && (chosen.length < min || urgent)) chosen.push(spot)
    out[part.id] = chosen.map((s) => s.id)
  }
  return out
}

// ---------------------------------------------------------------- RFQs

export function draftRfqs(req: PurchaseRequest, suppliers: Supplier[], settings: Settings): Rfq[] {
  const bySupplier = new Map<string, string[]>()
  for (const [partId, ids] of Object.entries(req.candidates)) {
    for (const sid of ids) {
      if (!bySupplier.has(sid)) bySupplier.set(sid, [])
      bySupplier.get(sid)!.push(partId)
    }
  }
  const rfqs: Rfq[] = []
  for (const [sid, partIds] of bySupplier) {
    const s = suppliers.find((x) => x.id === sid)
    if (!s) continue
    const existing = req.rfqs.find((r) => r.supplierId === sid && r.status !== 'draft')
    if (existing) continue
    const parts = partIds.map((id) => req.parts.find((p) => p.id === id)!).filter(Boolean)
    const thai = /[฀-๿]/.test(s.contact) || settings.lang === 'th'
    rfqs.push({
      id: uid('rfq'),
      supplierId: sid,
      partIds,
      subject: thai ? `ขอใบเสนอราคา ${req.id} – ${settings.companyName}` : `Request for quotation ${req.id} – ${settings.companyName}`,
      body: rfqBody(thai, s, parts, req, settings),
      status: 'draft'
    })
  }
  return rfqs
}

function rfqBody(thai: boolean, s: Supplier, parts: Part[], req: PurchaseRequest, st: Settings): string {
  const lines = parts.map(
    (p, i) => `${i + 1}. ${p.partNo}  ${p.name}${p.spec ? ` (${p.spec})` : ''}  ${p.qty.toLocaleString()} ${p.unit}`
  )
  if (thai) {
    return [
      `เรียน ${s.contact} (${s.name})`,
      '',
      `${st.companyName} ขอใบเสนอราคาสำหรับรายการต่อไปนี้ ต้องการรับของภายในวันที่ ${req.needBy}`,
      '',
      ...lines,
      '',
      'รบกวนแจ้งในใบเสนอราคา: ราคาต่อหน่วย, MOQ, ระยะเวลาส่งของ, เงื่อนไขการชำระเงิน (เครดิตกี่วัน) และยืนราคากี่วัน',
      '',
      'ขอบคุณครับ',
      `${st.buyerName}`,
      `ฝ่ายจัดซื้อ ${st.companyName}`
    ].join('\n')
  }
  return [
    `Dear ${s.contact},`,
    '',
    `${st.companyName} would like a quotation for the items below, delivered by ${req.needBy}.`,
    '',
    ...lines,
    '',
    'Please state the unit price, MOQ, lead time, payment terms (credit days) and how long the price is valid.',
    '',
    'Best regards,',
    `${st.buyerName}`,
    `Purchasing, ${st.companyName}`
  ].join('\n')
}

/** Simulated reply delay in milliseconds for the offline demo, or null when the supplier never replies. */
export function replyDelayMs(s: Supplier, speed: Settings['replySpeed']): number | null {
  if (s.profile.replyHours >= 999) return null
  const jitter = 0.6 + hash01(s.id) * 0.8
  if (speed === 'instant') return 300 + hash01(s.id) * 900
  if (speed === 'fast') return Math.round((2500 + s.profile.replyHours * 1500) * jitter)
  return Math.round(s.profile.replyHours * 60 * 1000 * jitter) // one simulated hour = one real minute
}

/** Build the supplier's reply email text. Formats vary on purpose so the quote reader has work to do. */
export function simulateReply(s: Supplier, rfq: Rfq, req: PurchaseRequest): string {
  const parts = rfq.partIds.map((id) => req.parts.find((p) => p.id === id)!).filter(Boolean)
  const style = Math.floor(hash01(s.id + 'style') * 3)
  const items = parts.map((p) => {
    const std = p.standardPrice ?? ITEM_MASTER[p.partNo]?.standardPrice ?? 100
    const noise = 0.94 + hash01(s.id + p.partNo) * 0.12
    const price = Math.round(std * s.profile.priceFactor * noise * 100) / 100
    const lead = s.profile.leadDays + Math.floor(hash01(p.partNo + s.id) * 3)
    const moq = s.profile.moq
    const pay = s.profile.paymentDays
    const valid = 15 + Math.floor(hash01(s.id + 'v') * 4) * 15
    if (style === 0) {
      return `${p.partNo} ${p.name}\n  ราคาต่อหน่วย ${fmtMoney(price)} บาท\n  MOQ ${moq} ${p.unit}\n  ส่งของภายใน ${lead} วัน\n  เครดิต ${pay} วัน\n  ยืนราคา ${valid} วัน`
    }
    if (style === 1) {
      return `- ${p.partNo}: THB ${fmtMoney(price)}/${p.unit}, MOQ ${moq}, lead time ${lead} days, payment ${pay === 0 ? 'cash before delivery' : pay + ' days credit'}, price valid ${valid} days`
    }
    return `Item ${p.partNo} | Unit price ${fmtMoney(price)} THB | Min. order ${moq} | Delivery ${lead} days after PO | Terms: ${pay === 0 ? 'cash' : 'credit ' + pay + ' days'} | Validity ${valid} days`
  })
  const greet = style === 0 ? `เรียน ฝ่ายจัดซื้อ\n\nขอบคุณที่ให้โอกาส ${s.name} เสนอราคาดังนี้` : `Dear Purchasing team,\n\nThank you for your RFQ. Our quotation from ${s.name}:`
  const sign = style === 0 ? `\n\nขอแสดงความนับถือ\n${s.contact}` : `\n\nBest regards,\n${s.contact}\n${s.name}`
  return `${greet}\n\n${items.join('\n\n')}${sign}`
}

// ---------------------------------------------------------------- quote reading

const NUM = '([\\d,]+(?:\\.\\d+)?)'

/** Extract structured quotes for each part number mentioned in a supplier email. */
export function readQuoteMail(mail: Mail, rfq: Rfq, req: PurchaseRequest): Quote[] {
  const parts = rfq.partIds.map((id) => req.parts.find((p) => p.id === id)!).filter(Boolean)
  const text = mail.body
  const positions = parts
    .map((p) => ({ p, at: text.indexOf(p.partNo) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
  const quotes: Quote[] = []
  positions.forEach(({ p, at }, i) => {
    const chunk = text.slice(at, i + 1 < positions.length ? positions[i + 1].at : undefined)
    const price = firstNum(chunk, [
      new RegExp(`ราคาต่อหน่วย\\s*${NUM}`), new RegExp(`THB\\s*${NUM}`), new RegExp(`Unit price\\s*${NUM}`, 'i'), new RegExp(`${NUM}\\s*(?:บาท|THB)`)
    ])
    if (!price) return
    const moq = firstNum(chunk, [new RegExp(`MOQ\\s*${NUM}`, 'i'), new RegExp(`Min\\.? order\\s*${NUM}`, 'i')]) ?? 1
    const lead = firstNum(chunk, [new RegExp(`ส่งของภายใน\\s*${NUM}`), new RegExp(`lead time\\s*${NUM}`, 'i'), new RegExp(`Delivery\\s*${NUM}`, 'i')]) ?? 0
    const cash = /cash/i.test(chunk) || /เงินสด/.test(chunk)
    const pay = cash ? 0 : firstNum(chunk, [new RegExp(`เครดิต\\s*${NUM}`), new RegExp(`payment\\s*${NUM}`, 'i'), new RegExp(`credit\\s*${NUM}`, 'i')]) ?? 0
    const valid = firstNum(chunk, [new RegExp(`ยืนราคา\\s*${NUM}`), new RegExp(`valid(?:ity)?\\s*${NUM}`, 'i')]) ?? 30
    quotes.push({
      id: uid('q'),
      rfqId: rfq.id,
      supplierId: rfq.supplierId,
      partId: p.id,
      unitPrice: price,
      moq,
      leadDays: lead,
      paymentDays: pay,
      validityDays: valid,
      receivedAt: mail.at,
      sourceMailId: mail.id
    })
  })
  return quotes
}

function firstNum(text: string, patterns: RegExp[]): number | undefined {
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return parseNumber(m[1])
  }
  return undefined
}

// ---------------------------------------------------------------- comparison

export function bandOf(price: number, std: number | undefined, st: Settings): Pick['band'] {
  if (!std) return 'no_standard'
  const diff = (price - std) / std
  if (diff > st.bandHighPct / 100) return 'above'
  if (diff < -st.bandLowPct / 100) return 'below'
  return 'inside'
}

export interface ScoredQuote {
  quote: Quote
  score: number
  late: boolean
  reasons: FactorReason[]
}

export function scoreQuotes(part: Part, quotes: Quote[], suppliers: Supplier[], fromIso = now()): ScoredQuote[] {
  const qs = quotes.filter((q) => q.partId === part.id)
  if (qs.length === 0) return []
  const minPrice = Math.min(...qs.map((q) => q.unitPrice))
  const minLead = Math.max(1, Math.min(...qs.map((q) => q.leadDays)))
  const maxPay = Math.max(1, ...qs.map((q) => q.paymentDays))
  const daysLeft = daysBetween(fromIso, part.needBy)
  return qs
    .map((q) => {
      const s = suppliers.find((x) => x.id === q.supplierId)
      const late = q.leadDays > daysLeft
      const priceScore = minPrice / q.unitPrice
      const leadScore = minLead / Math.max(1, q.leadDays)
      const payScore = q.paymentDays / maxPay
      const trust = s?.verified ? 1 : s?.known ? 0.7 : 0.3
      const moqShort = q.moq > part.qty
      const score = 0.5 * priceScore + 0.15 * leadScore + 0.15 * payScore + 0.2 * trust - (late ? 0.6 : 0) - (moqShort ? 0.15 : 0)
      const pct = Math.round((q.unitPrice / minPrice - 1) * 100)
      const reasons: FactorReason[] = [
        {
          factor: 'price',
          good: pct <= 3,
          text: pct === 0 ? bi('ราคาต่ำสุด', 'Lowest price') : bi(`แพงกว่าราคาต่ำสุด ${pct}%`, `${pct}% above the lowest price`)
        },
        {
          factor: 'lead',
          good: !late,
          text: late
            ? bi(`ส่งของ ${q.leadDays} วัน ไม่ทันวันที่ต้องการ (เหลือ ${daysLeft} วัน)`, `${q.leadDays}-day lead time misses the need-by date (${daysLeft} days left)`)
            : bi(`ส่งของ ${q.leadDays} วัน ทันกำหนด`, `${q.leadDays}-day lead time is on time`)
        },
        {
          factor: 'payment',
          good: q.paymentDays >= 30,
          text: q.paymentDays === 0 ? bi('ต้องจ่ายเงินสด', 'Cash payment required') : bi(`เครดิต ${q.paymentDays} วัน`, `${q.paymentDays} days credit`)
        },
        {
          factor: 'moq',
          good: !moqShort,
          text: moqShort
            ? bi(`MOQ ${q.moq} มากกว่าที่ต้องการ (${part.qty})`, `MOQ ${q.moq} is above the ${part.qty} needed`)
            : bi(`MOQ ${q.moq} ไม่เกินจำนวนที่สั่ง`, `MOQ ${q.moq} fits the order`)
        },
        {
          factor: 'trust',
          good: !!s?.verified,
          text: s?.verified
            ? bi('ผู้ขายเดิม ผ่านการตรวจโรงงานแล้ว', 'Existing supplier, already audited')
            : bi('ผู้ขายใหม่ ต้องตรวจโรงงานก่อนสั่งครั้งแรก', 'New supplier, needs an audit before the first order')
        }
      ]
      return { quote: q, score: Math.round(score * 1000) / 1000, late, reasons }
    })
    .sort((a, b) => b.score - a.score)
}

export function compareAll(req: PurchaseRequest, suppliers: Supplier[], st: Settings): Pick[] {
  const picks: Pick[] = []
  for (const part of req.parts) {
    const kept = req.picks.find((p) => p.partId === part.id && p.overridden)
    if (kept) {
      picks.push(kept)
      continue
    }
    const scored = scoreQuotes(part, req.quotes, suppliers)
    if (scored.length === 0) continue
    const best = scored[0]
    picks.push({
      partId: part.id,
      supplierId: best.quote.supplierId,
      quoteId: best.quote.id,
      score: best.score,
      reasons: best.reasons,
      band: bandOf(best.quote.unitPrice, part.standardPrice, st)
    })
  }
  return picks
}

export function overridePick(req: PurchaseRequest, partId: string, quoteId: string, suppliers: Supplier[], st: Settings): void {
  const part = req.parts.find((p) => p.id === partId)
  const q = req.quotes.find((x) => x.id === quoteId)
  if (!part || !q) return
  const scored = scoreQuotes(part, req.quotes, suppliers).find((x) => x.quote.id === quoteId)
  req.picks = req.picks.filter((p) => p.partId !== partId)
  req.picks.push({
    partId,
    supplierId: q.supplierId,
    quoteId,
    score: scored?.score ?? 0,
    reasons: scored?.reasons ?? [],
    band: bandOf(q.unitPrice, part.standardPrice, st),
    overridden: true
  })
}

export function needsHead(req: PurchaseRequest): boolean {
  return req.picks.some((p) => p.band === 'above')
}

// ---------------------------------------------------------------- PO drafting

export function draftPos(req: PurchaseRequest, state: AppState): PurchaseOrder[] {
  const bySupplier = new Map<string, Pick[]>()
  for (const pk of req.picks) {
    if (!bySupplier.has(pk.supplierId)) bySupplier.set(pk.supplierId, [])
    bySupplier.get(pk.supplierId)!.push(pk)
  }
  const pos: PurchaseOrder[] = []
  for (const [sid, picks] of bySupplier) {
    const s = state.suppliers.find((x) => x.id === sid)
    state.seq.po += 1
    const lines = picks.map((pk) => {
      const part = req.parts.find((p) => p.id === pk.partId)!
      const q = req.quotes.find((x) => x.id === pk.quoteId)!
      return { partId: part.id, supplierId: sid, qty: Math.max(part.qty, q.moq), unitPrice: q.unitPrice }
    })
    const total = Math.round(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) * 100) / 100
    const checks: PurchaseOrder['checks'] = []
    for (const l of lines) {
      const part = req.parts.find((p) => p.id === l.partId)!
      const q = req.quotes.find((x) => x.partId === l.partId && x.supplierId === sid)!
      checks.push(
        l.qty === part.qty
          ? { ok: true, text: bi(`${part.partNo}: จำนวนตรงกับใบขอซื้อ (${part.qty} ${part.unit})`, `${part.partNo}: quantity matches the request (${part.qty} ${part.unit})`) }
          : { ok: false, text: bi(`${part.partNo}: ปรับจำนวนเป็น ${l.qty} ตาม MOQ (ขอ ${part.qty})`, `${part.partNo}: quantity raised to ${l.qty} to meet MOQ (asked ${part.qty})`) }
      )
      checks.push(
        l.unitPrice === q.unitPrice
          ? { ok: true, text: bi(`${part.partNo}: ราคาตรงกับใบเสนอราคา`, `${part.partNo}: price matches the quote`) }
          : { ok: false, text: bi(`${part.partNo}: ราคาไม่ตรงกับใบเสนอราคา`, `${part.partNo}: price differs from the quote`) }
      )
      const age = daysBetween(q.receivedAt, now())
      checks.push(
        age <= q.validityDays
          ? { ok: true, text: bi(`${part.partNo}: ใบเสนอราคายังไม่หมดอายุ`, `${part.partNo}: quote still valid`) }
          : { ok: false, text: bi(`${part.partNo}: ใบเสนอราคาหมดอายุแล้ว`, `${part.partNo}: quote has expired`) }
      )
    }
    const sum = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)
    checks.push({ ok: Math.abs(sum - total) < 0.01, text: bi(`ยอดรวมคำนวณถูกต้อง ${fmtMoney(total)} บาท`, `Total recalculated: THB ${fmtMoney(total)}`) })
    if (s && !s.verified) {
      checks.push({ ok: false, text: bi(`${s.name} ยังไม่ผ่านการตรวจโรงงาน`, `${s.name} has not been audited yet`) })
    }
    pos.push({
      number: `PO-${new Date().getFullYear()}-${String(state.seq.po).padStart(4, '0')}`,
      supplierId: sid,
      lines,
      createdAt: now(),
      total,
      checks
    })
  }
  return pos
}

// ---------------------------------------------------------------- summaries for the agent

export function requestSummary(req: PurchaseRequest, suppliers: Supplier[]): string {
  const sName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? id
  const lines = [
    `Request ${req.id} "${req.title}", status ${req.status}, need-by ${req.needBy}, approval ${req.approval}.`,
    'Parts:',
    ...req.parts.map((p) => `- [${p.id}] ${p.partNo} ${p.name} ${p.qty} ${p.unit}, standard price ${p.standardPrice ?? 'none'} THB, need by ${p.needBy}`),
    `Candidates: ${Object.entries(req.candidates).map(([pid, ids]) => `${pid}: ${ids.map(sName).join(', ')}`).join('; ') || 'none'}`,
    `RFQs: ${req.rfqs.map((r) => `${sName(r.supplierId)} (${r.status})`).join(', ') || 'none'}`,
    `Quotes: ${req.quotes.map((q) => `${q.partId}@${sName(q.supplierId)} ${q.unitPrice} THB, MOQ ${q.moq}, ${q.leadDays}d, credit ${q.paymentDays}d`).join('; ') || 'none'}`,
    `Picks: ${req.picks.map((p) => `${p.partId} -> ${sName(p.supplierId)} (${p.band})`).join('; ') || 'none'}`
  ]
  return lines.join('\n')
}
