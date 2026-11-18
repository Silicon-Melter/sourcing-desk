// App state store: one AppState object, saved to this browser, changed only through actions.
import { useSyncExternalStore } from 'react'
import type { AppState, Bi, ChatMessage, Mail, Part, PurchaseRequest, SuggestedAction } from '@shared/types'
import { initialState, sampleParts } from '@shared/sample'
import {
  bi, compareAll, draftPos, draftRfqs, findSuppliers, log, needsHead, newRequest, now, overridePick, readQuoteMail,
  replyDelayMs, simulateReply, uid
} from '@shared/logic'

const KEY = 'sourcing-desk:v1'

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as AppState
      if (s && s.settings && Array.isArray(s.requests)) return { ...initialState(), ...s, settings: { ...initialState().settings, ...s.settings } }
    }
  } catch {
    /* storage blocked: start fresh */
  }
  return initialState()
}

let state: AppState = load()
let firstRun = state.requests.length === 0 && state.seq.request === 0
const listeners = new Set<() => void>()
let saveTimer: number | undefined

function emit(): void {
  for (const l of listeners) l()
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* ignore */
    }
  }, 200)
}

export function getState(): AppState {
  return state
}

/** Apply a change to a deep copy, then publish it. */
export function update(fn: (draft: AppState) => void): void {
  const draft = structuredClone(state)
  fn(draft)
  state = draft
  emit()
}

export function useApp(): AppState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

export function findReq(s: AppState, id: string): PurchaseRequest {
  const r = s.requests.find((x) => x.id === id)
  if (!r) throw new Error(`Request ${id} not found`)
  return r
}

function L(s: AppState, b: Bi): string {
  return b[s.settings.lang]
}

export function pushChat(reqId: string, msg: Omit<ChatMessage, 'id' | 'at'>): void {
  update((s) => {
    findReq(s, reqId).chat.push({ ...msg, id: uid('m'), at: now() })
  })
}

function notify(s: AppState, text: Bi, requestId?: string): void {
  s.notifications.unshift({ id: uid('n'), at: now(), text, requestId, read: false })
  s.notifications = s.notifications.slice(0, 50)
}

// ---------------------------------------------------------------- requests

export function createRequest(title: string, parts: Part[], intro?: Bi): string {
  let id = ''
  update((s) => {
    const req = newRequest(s, title, parts)
    id = req.id
    log(req, 'buyer', bi(`สร้างใบขอซื้อ ${parts.length} รายการ`, `Created the request with ${parts.length} parts`))
    req.chat.push({
      id: uid('m'),
      at: now(),
      role: 'agent',
      text: L(
        s,
        intro ??
          bi(
            `ได้รับรายการ ${parts.length} รายการแล้ว ต้องการภายใน ${req.needBy}\nให้ผมหาผู้ขายอย่างน้อย 3 รายต่อรายการ แล้วร่างอีเมลขอใบเสนอราคาเลยไหมครับ`,
            `Got ${parts.length} parts, needed by ${req.needBy}.\nShall I find at least 3 suppliers per part and draft the RFQ emails?`
          )
      ),
      actions: [{ kind: 'find_suppliers', label: L(s, bi('หาผู้ขายและร่าง RFQ', 'Find suppliers and draft RFQs')) }]
    })
    s.requests.unshift(req)
  })
  return id
}

/** Open in a realistic working state: one sample request on first run. */
export function seedIfFirstRun(): void {
  if (!firstRun) return
  firstRun = false
  createSampleRequest()
}

export function createSampleRequest(): string {
  const s = getState()
  const title = s.settings.lang === 'th' ? 'วัตถุดิบไลน์ประกอบ ล็อต ธ.ค.' : 'Assembly line materials, Dec lot'
  return createRequest(title, sampleParts())
}

export function updatePart(reqId: string, partId: string, patch: Partial<Part>): void {
  update((s) => {
    const req = findReq(s, reqId)
    const p = req.parts.find((x) => x.id === partId)
    if (!p) return
    Object.assign(p, patch)
    req.needBy = req.parts.map((x) => x.needBy).sort()[0] ?? req.needBy
    log(req, 'buyer', bi(`แก้ไข ${p.partNo}`, `Edited ${p.partNo}`))
  })
}

export function addParts(reqId: string, parts: Part[]): void {
  update((s) => {
    const req = findReq(s, reqId)
    req.parts.push(...parts)
    log(req, 'agent', bi(`เพิ่ม ${parts.length} รายการ`, `Added ${parts.length} parts`))
  })
}

export function removePart(reqId: string, partId: string): void {
  update((s) => {
    const req = findReq(s, reqId)
    req.parts = req.parts.filter((p) => p.id !== partId)
    delete req.candidates[partId]
  })
}

// ---------------------------------------------------------------- agent tools (also used by buttons)

export interface ToolOutcome {
  summary: Bi
  data?: unknown
}

export function toolFindSuppliers(reqId: string): ToolOutcome {
  let out: ToolOutcome = { summary: bi('', '') }
  update((s) => {
    const req = findReq(s, reqId)
    req.candidates = findSuppliers(req, s.suppliers)
    const ids = new Set(Object.values(req.candidates).flat())
    const fresh = [...ids].filter((id) => !s.suppliers.find((x) => x.id === id)?.known).length
    log(req, 'agent', bi(`หาผู้ขายได้ ${ids.size} ราย (ใหม่ ${fresh} ราย)`, `Found ${ids.size} suppliers (${fresh} new)`))
    out = {
      summary: bi(`หาผู้ขายได้ ${ids.size} ราย เป็นผู้ขายเดิม ${ids.size - fresh} ราย และรายใหม่จากการค้นหา ${fresh} ราย`, `Found ${ids.size} suppliers: ${ids.size - fresh} existing and ${fresh} new from search`),
      data: req.parts.map((p) => ({
        partNo: p.partNo,
        suppliers: (req.candidates[p.id] ?? []).map((id) => {
          const sp = s.suppliers.find((x) => x.id === id)!
          return { name: sp.name, existing: sp.known, audited: sp.verified, typicalLeadDays: sp.profile.leadDays }
        })
      }))
    }
  })
  return out
}

export function toolDraftRfqs(reqId: string): ToolOutcome {
  let out: ToolOutcome = { summary: bi('', '') }
  update((s) => {
    const req = findReq(s, reqId)
    if (Object.keys(req.candidates).length === 0) req.candidates = findSuppliers(req, s.suppliers)
    req.rfqs = req.rfqs.filter((r) => r.status !== 'draft')
    const drafts = draftRfqs(req, s.suppliers, s.settings)
    req.rfqs.push(...drafts)
    log(req, 'agent', bi(`ร่างอีเมล RFQ ${drafts.length} ฉบับ`, `Drafted ${drafts.length} RFQ emails`))
    out = {
      summary: bi(`ร่างอีเมลขอใบเสนอราคา ${drafts.length} ฉบับ รอผู้ซื้อตรวจและกดส่ง`, `Drafted ${drafts.length} RFQ emails, waiting for the buyer to check and send`),
      data: { drafts: drafts.length, note: 'The buyer must review and press Send; the agent cannot send email.' }
    }
  })
  return out
}

export function toolCompare(reqId: string): ToolOutcome {
  let out: ToolOutcome = { summary: bi('', '') }
  update((s) => {
    const req = findReq(s, reqId)
    req.picks = compareAll(req, s.suppliers, s.settings)
    if (req.picks.length > 0 && req.status !== 'po_issued') req.status = 'ready'
    const above = req.picks.filter((p) => p.band === 'above').length
    log(req, 'agent', bi(`เปรียบเทียบใบเสนอราคา เลือก ${req.picks.length} รายการ`, `Compared quotes, picked ${req.picks.length} parts`))
    const sName = (id: string) => s.suppliers.find((x) => x.id === id)?.name ?? id
    out = {
      summary:
        above > 0
          ? bi(`เลือกผู้ขายครบ ${req.picks.length} รายการ มี ${above} รายการราคาเกินกรอบ ต้องให้หัวหน้าอนุมัติ`, `Picked suppliers for ${req.picks.length} parts; ${above} above the price band need the head's approval`)
          : bi(`เลือกผู้ขายครบ ${req.picks.length} รายการ ทุกรายการอยู่ในกรอบราคา`, `Picked suppliers for ${req.picks.length} parts, all inside the price band`),
      data: req.picks.map((p) => {
        const part = req.parts.find((x) => x.id === p.partId)!
        const q = req.quotes.find((x) => x.id === p.quoteId)!
        return {
          partNo: part.partNo,
          supplier: sName(p.supplierId),
          unitPrice: q.unitPrice,
          standardPrice: part.standardPrice,
          band: p.band,
          leadDays: q.leadDays,
          reasons: p.reasons.map((r) => r.text.en)
        }
      })
    }
  })
  return out
}

// ---------------------------------------------------------------- RFQs and the simulated mailbox

export function editRfq(reqId: string, rfqId: string, patch: { subject?: string; body?: string }): void {
  update((s) => {
    const r = findReq(s, reqId).rfqs.find((x) => x.id === rfqId)
    if (r) Object.assign(r, patch)
  })
}

export function discardRfq(reqId: string, rfqId: string): void {
  update((s) => {
    const req = findReq(s, reqId)
    req.rfqs = req.rfqs.filter((x) => x.id !== rfqId)
  })
}

export function sendRfqs(reqId: string, rfqIds: string[]): void {
  update((s) => {
    const req = findReq(s, reqId)
    const t0 = Date.now()
    let n = 0
    for (const r of req.rfqs) {
      if (!rfqIds.includes(r.id) || r.status !== 'draft') continue
      const sup = s.suppliers.find((x) => x.id === r.supplierId)!
      r.status = 'sent'
      r.sentAt = now()
      n++
      s.mailbox.unshift({ id: uid('mail'), direction: 'out', supplierId: sup.id, requestId: req.id, rfqId: r.id, subject: r.subject, body: r.body, at: now(), delivered: true })
      const delay = replyDelayMs(sup, s.settings.replySpeed)
      if (delay !== null) {
        const subj = (sup.profile.paymentDays === 0 ? 'Quotation: ' : 'RE: ') + r.subject
        s.mailbox.unshift({
          id: uid('mail'), direction: 'in', supplierId: sup.id, requestId: req.id, rfqId: r.id, subject: subj,
          body: simulateReply(sup, r, req), at: new Date(t0 + delay).toISOString(), delivered: false
        })
      }
    }
    if (n > 0) {
      req.status = 'rfq_sent'
      log(req, 'buyer', bi(`ส่ง RFQ ${n} ฉบับ`, `Sent ${n} RFQs`))
      req.chat.push({
        id: uid('m'), at: now(), role: 'agent',
        text: L(s, bi(`ส่งอีเมลแล้ว ${n} ฉบับ ผมจะอ่านใบเสนอราคาที่ตอบกลับมาและเปรียบเทียบให้ทันที`, `Sent ${n} emails. I'll read each quote as it comes back and compare them for you.`))
      })
    }
  })
}

/** Deliver simulated replies whose time has come, read their quotes and compare when all are in. */
export function tick(): void {
  const s0 = getState()
  const due = s0.mailbox.filter((m) => m.direction === 'in' && !m.delivered && Date.parse(m.at) <= Date.now())
  const stale = s0.requests.some((r) => r.status === 'rfq_sent' || r.status === 'quotes_in')
  if (due.length === 0 && !stale) return
  if (due.length === 0) {
    // When the last expected reply has arrived, settle the rest as "no reply" and compare.
    const ready = s0.requests.filter((r) => (r.status === 'rfq_sent' || r.status === 'quotes_in') && r.quotes.length > 0 && !pendingFor(s0.mailbox, r.id))
    if (ready.length === 0) return
    update((s) => ready.forEach((r) => settle(s, findReq(s, r.id))))
    return
  }
  update((s) => {
    for (const d of due) {
      const mail = s.mailbox.find((m) => m.id === d.id)!
      mail.delivered = true
      mail.at = now()
      const req = s.requests.find((r) => r.id === mail.requestId)
      if (!req) continue
      const rfq = req.rfqs.find((r) => r.id === mail.rfqId)
      if (!rfq) continue
      rfq.status = 'replied'
      rfq.repliedAt = mail.at
      const quotes = readQuoteMail(mail as Mail, rfq, req)
      req.quotes = req.quotes.filter((q) => q.rfqId !== rfq.id).concat(quotes)
      if (req.status === 'rfq_sent') req.status = 'quotes_in'
      const sup = s.suppliers.find((x) => x.id === mail.supplierId)!
      log(req, 'agent', bi(`อ่านใบเสนอราคาจาก ${sup.name} (${quotes.length} รายการ)`, `Read the quote from ${sup.name} (${quotes.length} items)`))
      req.chat.push({
        id: uid('m'), at: now(), role: 'tool', toolName: 'read_quote',
        text: L(
          s,
          bi(
            `อ่านใบเสนอราคาจาก ${sup.name}: ${quotes.map((q) => `${req.parts.find((p) => p.id === q.partId)?.partNo} ${q.unitPrice} บาท`).join(', ')}`,
            `Read the quote from ${sup.name}: ${quotes.map((q) => `${req.parts.find((p) => p.id === q.partId)?.partNo} THB ${q.unitPrice}`).join(', ')}`
          )
        )
      })
      if (!pendingFor(s.mailbox, req.id)) settle(s, req)
    }
  })
}

function pendingFor(mailbox: Mail[], reqId: string): boolean {
  return mailbox.some((m) => m.requestId === reqId && m.direction === 'in' && !m.delivered)
}

function settle(s: AppState, req: PurchaseRequest): void {
  const silent = req.rfqs.filter((r) => r.status === 'sent')
  silent.forEach((r) => (r.status = 'no_reply'))
  req.picks = compareAll(req, s.suppliers, s.settings)
  req.status = 'ready'
  const above = req.picks.filter((p) => p.band === 'above').length
  const silentNames = silent.map((r) => s.suppliers.find((x) => x.id === r.supplierId)?.name).join(', ')
  log(req, 'agent', bi('เปรียบเทียบใบเสนอราคาครบแล้ว', 'Compared all quotes'))
  req.chat.push({
    id: uid('m'), at: now(), role: 'agent',
    text: L(
      s,
      bi(
        `ได้ใบเสนอราคาครบแล้ว${silent.length ? ` (ยกเว้น ${silentNames} ที่ยังไม่ตอบ)` : ''} ผมเลือกผู้ขายให้ทุกรายการพร้อมเหตุผลในแท็บเปรียบเทียบ${above ? `\nมี ${above} รายการราคาเกินกรอบ ต้องให้หัวหน้าอนุมัติ` : '\nทุกรายการอยู่ในกรอบราคา อนุมัติได้เลย'}`,
        `All quotes are in${silent.length ? ` (except ${silentNames}, no reply)` : ''}. I picked a supplier for every part, with reasons, in the Comparison tab.${above ? `\n${above} picks are above the price band and need the head's approval.` : '\nEverything is inside the price band, so you can approve it yourself.'}`
      )
    ),
    actions: [{ kind: 'open_compare', label: L(s, bi('ดูตารางเปรียบเทียบ', 'Open the comparison')) }]
  })
  notify(s, bi(`${req.id}: ใบเสนอราคาครบ พร้อมอนุมัติ`, `${req.id}: quotes are in, ready to approve`), req.id)
}

export function choosePick(reqId: string, partId: string, quoteId: string): void {
  update((s) => {
    const req = findReq(s, reqId)
    overridePick(req, partId, quoteId, s.suppliers, s.settings)
    const part = req.parts.find((p) => p.id === partId)!
    const sup = s.suppliers.find((x) => x.id === req.quotes.find((q) => q.id === quoteId)?.supplierId)
    log(req, 'buyer', bi(`เปลี่ยนผู้ขาย ${part.partNo} เป็น ${sup?.name}`, `Changed ${part.partNo} to ${sup?.name}`))
    if (req.approval === 'head_rejected') req.approval = 'none'
  })
}

// ---------------------------------------------------------------- approval and POs

export function buyerApprove(reqId: string): void {
  update((s) => {
    const req = findReq(s, reqId)
    if (req.picks.length === 0) return
    if (needsHead(req)) {
      req.approval = 'awaiting_head'
      log(req, 'buyer', bi('ส่งให้หัวหน้าอนุมัติ (ราคาเกินกรอบ)', 'Sent to the head for approval (above the price band)'))
      notify(s, bi(`${req.id}: รอหัวหน้าอนุมัติ ราคาเกินกรอบ`, `${req.id}: waiting for the head, price above the band`), req.id)
    } else {
      req.approval = 'buyer_approved'
      log(req, 'buyer', bi('อนุมัติการเลือกผู้ขาย', 'Approved the picks'))
      issue(s, req)
    }
  })
}

export function headDecide(reqId: string, ok: boolean, note: string): void {
  update((s) => {
    const req = findReq(s, reqId)
    if (req.approval !== 'awaiting_head') return
    req.approval = ok ? 'head_approved' : 'head_rejected'
    req.approvalNote = note || undefined
    log(req, 'head', ok ? bi('หัวหน้าอนุมัติ', 'Head approved') : bi(`หัวหน้าไม่อนุมัติ: ${note || '-'}`, `Head rejected: ${note || '-'}`))
    if (ok) issue(s, req)
    else {
      req.chat.push({
        id: uid('m'), at: now(), role: 'agent',
        text: L(s, bi(`หัวหน้าไม่อนุมัติ${note ? `: "${note}"` : ''} เลือกผู้ขายรายอื่นในแท็บเปรียบเทียบ แล้วส่งอนุมัติใหม่ได้ครับ`, `The head rejected it${note ? `: "${note}"` : ''}. Pick another supplier in the Comparison tab and send it again.`)),
        actions: [{ kind: 'open_compare', label: L(s, bi('ดูตารางเปรียบเทียบ', 'Open the comparison')) }]
      })
    }
  })
}

function issue(s: AppState, req: PurchaseRequest): void {
  req.pos = draftPos(req, s)
  req.status = 'po_issued'
  const warn = req.pos.flatMap((p) => p.checks).filter((c) => !c.ok).length
  log(req, 'system', bi(`ออก PO ${req.pos.length} ใบ`, `Issued ${req.pos.length} POs`))
  req.chat.push({
    id: uid('m'), at: now(), role: 'agent',
    text: L(
      s,
      bi(
        `ออกร่าง PO ${req.pos.length} ใบ (${req.pos.map((p) => p.number).join(', ')}) ตรวจจำนวน ราคา และยอดรวมแล้ว${warn ? ` มี ${warn} จุดที่ควรตรวจ` : ''} ดาวน์โหลดเป็น Excel ได้ในแท็บ PO`,
        `Drafted ${req.pos.length} POs (${req.pos.map((p) => p.number).join(', ')}). Quantities, prices and totals are checked${warn ? `; ${warn} points need a look` : ''}. Download them as Excel in the PO tab.`
      )
    )
  })
  notify(s, bi(`${req.id}: ออก PO แล้ว`, `${req.id}: POs issued`), req.id)
}

// ---------------------------------------------------------------- misc

export function markNotificationsRead(): void {
  update((s) => s.notifications.forEach((n) => (n.read = true)))
}

export function resetAll(): void {
  state = initialState()
  emit()
}

export function suggested(kind: SuggestedAction['kind'], s: AppState): SuggestedAction {
  const labels: Record<SuggestedAction['kind'], Bi> = {
    find_suppliers: bi('หาผู้ขายและร่าง RFQ', 'Find suppliers and draft RFQs'),
    draft_rfqs: bi('ร่างอีเมล RFQ', 'Draft RFQ emails'),
    open_rfqs: bi('ตรวจอีเมล RFQ', 'Review the RFQ emails'),
    check_mail: bi('ดูกล่องอีเมล', 'Open the mailbox'),
    compare: bi('เปรียบเทียบตอนนี้', 'Compare now'),
    open_compare: bi('ดูตารางเปรียบเทียบ', 'Open the comparison'),
    draft_po: bi('ไปที่ PO', 'Go to the PO')
  }
  return { kind, label: L(s, labels[kind]) }
}
