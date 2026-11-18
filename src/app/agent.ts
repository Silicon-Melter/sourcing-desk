// The purchasing agent. With Claude available it runs a tool-using loop through the
// artifact `sample` capability (the viewer's Claude account); otherwise a scripted agent
// handles the common briefs so the demo always works.
import type { AppState, Lang, Part, SuggestedAction } from '@shared/types'
import { addDays } from '@shared/sample'
import { bi, guessCategory, partsFromText, requestSummary, uid } from '@shared/logic'
import { ITEM_MASTER } from '@shared/sample'
import {
  addParts, findReq, getState, pushChat, suggested, toolCompare, toolDraftRfqs, toolFindSuppliers, updatePart, type ToolOutcome
} from './store'

// Minimal typing for the artifact runtime (see the platform's claude.d.ts / sample.d.ts).
interface SampleTool {
  name: string
  description: string
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  execute(input: Record<string, unknown>, ctx: { signal: AbortSignal }): unknown
}
type SampleFn = ((
  input: string | { role: 'user' | 'assistant'; content: string }[],
  opts?: { onText?: (u: { text: string; delta: string }) => void; signal?: AbortSignal; tools?: SampleTool[]; images?: Blob[]; modelTier?: string; cache?: boolean }
) => Promise<{ text: string; truncated: boolean }>) & { limits?: () => Promise<{ images?: unknown; tools?: unknown }> }

declare global {
  interface Window {
    claude?: { use(name: string): Promise<unknown> }
  }
}

export type AiStatus = 'checking' | 'on' | 'off'
let samplePromise: Promise<SampleFn | null> | null = null
let disabled = false

export function getSample(): Promise<SampleFn | null> {
  if (disabled) return Promise.resolve(null)
  if (!samplePromise) {
    samplePromise = window.claude?.use
      ? (window.claude.use('sample') as Promise<SampleFn | null>).catch(() => null)
      : Promise.resolve(null)
  }
  return samplePromise
}

export async function imagesSupported(): Promise<boolean> {
  const s = await getSample()
  if (!s?.limits) return false
  const l = await s.limits().catch(() => null)
  return !!l?.images
}

const HARD_STOP = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'tools_unavailable'])

export interface RunHandle {
  stop(): void
  done: Promise<void>
}

/** Handle one message from the buyer in a request's chat. */
export function runAgent(reqId: string, text: string, images: File[], onLive: (t: string | null) => void, onAi: (s: AiStatus) => void): RunHandle {
  const ctl = new AbortController()
  const done = (async () => {
    pushChat(reqId, { role: 'user', text: text || (images.length ? '📎' : '') })
    const sample = await getSample()
    if (sample) {
      try {
        await runClaude(sample, reqId, text, images, ctl.signal, onLive)
        onAi('on')
        return
      } catch (e) {
        const code = (e as { code?: string })?.code ?? 'upstream_error'
        if (code === 'cancelled') {
          pushChat(reqId, { role: 'agent', text: lang() === 'th' ? 'หยุดแล้ว' : 'Stopped.' })
          return
        }
        if (HARD_STOP.has(code)) {
          disabled = true
          onAi('off')
        }
        const partial = (e as { text?: string }).text
        if (partial) pushChat(reqId, { role: 'agent', text: partial })
        pushChat(reqId, {
          role: 'tool',
          toolName: 'notice',
          text:
            lang() === 'th'
              ? `เรียก Claude ไม่สำเร็จ (${code}) ใช้ผู้ช่วยแบบสคริปต์แทน`
              : `Claude could not answer (${code}); the scripted agent took over.`
        })
      } finally {
        onLive(null)
      }
    } else onAi('off')
    scripted(reqId, text)
  })()
  return { stop: () => ctl.abort(), done }
}

const lang = (): Lang => getState().settings.lang

function say(o: ToolOutcome): string {
  return o.summary[lang()]
}

// ---------------------------------------------------------------- Claude mode

function rules(s: AppState, reqId: string): string {
  const req = findReq(s, reqId)
  return [
    `You are the purchasing agent inside "Sourcing Desk", used by a buyer at ${s.settings.companyName}, a small Thai manufacturer.`,
    'You help the buyer go from a part list to an approved purchase order: find suppliers, draft RFQ emails, read quotes, compare them and explain the pick.',
    'Rules:',
    '- Reply in the language the buyer writes in (Thai by default). Keep replies short: 1-4 sentences or a short list. No markdown headings.',
    '- Use the tools to act on the request; never invent suppliers, prices or quotes that the tools did not return.',
    '- You cannot send email, approve, or issue a PO. Those need the buyer (or the purchasing head when a price is above the standard-price band). Tell the buyer which button to press next.',
    '- Supplier replies arrive in a simulated mailbox and are read automatically; you will see them in the request state.',
    `- Standard-price band: -${s.settings.bandLowPct}% to +${s.settings.bandHighPct}% around each part's standard price. Above the band needs the head's approval.`,
    '- When the buyer gives new items (typed, pasted, or in an attached photo of a BOM or a LINE chat), add them with add_parts. Ask only if quantity is missing.',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    '',
    'Current request state:',
    requestSummary(req, s.suppliers)
  ].join('\n')
}

function tools(reqId: string): SampleTool[] {
  return [
    {
      name: 'find_suppliers',
      description: 'Find at least 3 candidate suppliers per part: the company supplier list first, then new suppliers from search. Returns the candidates per part number.',
      execute: () => {
        const o = toolFindSuppliers(reqId)
        pushChat(reqId, { role: 'tool', toolName: 'find_suppliers', text: say(o) })
        return o.data
      }
    },
    {
      name: 'draft_rfqs',
      description: 'Draft one RFQ email per candidate supplier covering its parts (finds suppliers first if needed). Drafts wait for the buyer to review and send. Returns how many were drafted.',
      execute: () => {
        const o = toolDraftRfqs(reqId)
        pushChat(reqId, { role: 'tool', toolName: 'draft_rfqs', text: say(o), actions: [suggested('open_rfqs', getState())] })
        return o.data
      }
    },
    {
      name: 'compare_quotes',
      description: 'Score every received quote on price, lead time vs need-by date, payment terms, MOQ and supplier trust; pick the best per part and check it against the standard-price band. Returns the picks with reasons.',
      execute: () => {
        const req = findReq(getState(), reqId)
        if (req.quotes.length === 0) throw new Error('No quotes have arrived yet.')
        const o = toolCompare(reqId)
        pushChat(reqId, { role: 'tool', toolName: 'compare_quotes', text: say(o), actions: [suggested('open_compare', getState())] })
        return o.data
      }
    },
    {
      name: 'add_parts',
      description: 'Add parts to this request from what the buyer typed, pasted or photographed. Returns the part ids added.',
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                partNo: { type: 'string', description: 'Part code; make a short code if none is given' },
                name: { type: 'string' },
                spec: { type: 'string' },
                qty: { type: 'number' },
                unit: { type: 'string' },
                needBy: { type: 'string', description: 'YYYY-MM-DD' },
                standardPrice: { type: 'number', description: 'THB per unit if known' }
              },
              required: ['name', 'qty']
            }
          }
        },
        required: ['items']
      },
      execute: (input) => {
        const req = findReq(getState(), reqId)
        const items = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]) : []
        const parts: Part[] = items.slice(0, 50).map((it) => {
          const partNo = String(it.partNo ?? '').toUpperCase() || `ITEM-${Math.floor(Math.random() * 9000 + 1000)}`
          const name = String(it.name ?? partNo)
          const spec = String(it.spec ?? '')
          return {
            id: uid('part'), partNo, name, spec,
            qty: Number(it.qty) || 0,
            unit: String(it.unit ?? 'pcs'),
            needBy: /^\d{4}-\d{2}-\d{2}$/.test(String(it.needBy)) ? String(it.needBy) : req.needBy,
            standardPrice: Number(it.standardPrice) || ITEM_MASTER[partNo]?.standardPrice,
            category: ITEM_MASTER[partNo]?.category ?? guessCategory(`${partNo} ${name} ${spec}`)
          }
        })
        addParts(reqId, parts)
        pushChat(reqId, { role: 'tool', toolName: 'add_parts', text: lang() === 'th' ? `เพิ่ม ${parts.length} รายการ` : `Added ${parts.length} parts` })
        return parts.map((p) => ({ id: p.id, partNo: p.partNo }))
      }
    },
    {
      name: 'update_part',
      description: 'Change one part of the request (quantity, need-by date or standard price). Returns the updated part.',
      inputSchema: {
        type: 'object',
        properties: { partId: { type: 'string' }, qty: { type: 'number' }, needBy: { type: 'string' }, standardPrice: { type: 'number' } },
        required: ['partId']
      },
      execute: (input) => {
        const patch: Partial<Part> = {}
        if (input.qty !== undefined) patch.qty = Number(input.qty)
        if (input.needBy) patch.needBy = String(input.needBy)
        if (input.standardPrice !== undefined) patch.standardPrice = Number(input.standardPrice)
        updatePart(reqId, String(input.partId), patch)
        return findReq(getState(), reqId).parts.find((p) => p.id === String(input.partId)) ?? 'not found'
      }
    }
  ]
}

async function runClaude(sample: SampleFn, reqId: string, text: string, images: File[], signal: AbortSignal, onLive: (t: string | null) => void): Promise<void> {
  const s = getState()
  const req = findReq(s, reqId)
  // Recent conversation, buyer and agent turns only, ending on the new buyer message.
  const turns = req.chat
    .filter((m) => m.role !== 'tool')
    .slice(-12)
    .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.text }))
  while (turns.length && turns[0].role === 'assistant') turns.shift()
  const input = [{ role: 'user' as const, content: rules(s, reqId) }, ...turns]
  if (input[input.length - 1].role !== 'user') input.push({ role: 'user', content: text || 'Please read the attached image.' })
  onLive('')
  const res = await sample(input, {
    signal,
    tools: tools(reqId),
    images: images.length ? images : undefined,
    onText: ({ text: t }) => onLive(t)
  })
  onLive(null)
  const after = findReq(getState(), reqId)
  pushChat(reqId, { role: 'agent', text: res.text.trim(), actions: nextActions(after.status, after.rfqs.some((r) => r.status === 'draft')) })
}

function nextActions(status: string, hasDrafts: boolean): SuggestedAction[] {
  const s = getState()
  if (hasDrafts) return [suggested('open_rfqs', s)]
  if (status === 'new') return [suggested('find_suppliers', s)]
  if (status === 'ready') return [suggested('open_compare', s)]
  return []
}

// ---------------------------------------------------------------- scripted mode

function scripted(reqId: string, text: string): void {
  const s = getState()
  const req = findReq(s, reqId)
  const th = lang() === 'th'
  const t = text.toLowerCase()

  const weeks = t.match(/(\d+)\s*(สัปดาห์|อาทิตย์|weeks?)/)
  const days = t.match(/(\d+)\s*(วัน|days?)/)
  if (weeks || days) {
    const n = weeks ? Number(weeks[1]) * 7 : Number(days![1])
    const date = addDays(new Date().toISOString(), n)
    req.parts.forEach((p) => updatePart(reqId, p.id, { needBy: date }))
    pushChat(reqId, { role: 'tool', toolName: 'update_part', text: th ? `ตั้งวันที่ต้องการเป็น ${date}` : `Set the need-by date to ${date}` })
  }

  const pasted = text.split(/\r?\n/).filter((l) => l.trim()).length > 1 ? partsFromText(text, req.needBy) : { parts: [] }
  if (pasted.parts.length > 0) {
    addParts(reqId, pasted.parts)
    pushChat(reqId, { role: 'agent', text: th ? `เพิ่ม ${pasted.parts.length} รายการจากข้อความที่วางแล้ว` : `Added ${pasted.parts.length} parts from your text.`, actions: [suggested('find_suppliers', getState())] })
    return
  }

  if (/compare|เปรียบ|เทียบ|เลือก|best|ดีที่สุด/.test(t)) {
    if (req.quotes.length === 0) {
      pushChat(reqId, { role: 'agent', text: th ? 'ยังไม่มีใบเสนอราคา ส่ง RFQ ก่อนแล้วผมจะเปรียบเทียบให้เมื่อผู้ขายตอบ' : 'No quotes yet. Send the RFQs first and I will compare as replies arrive.', actions: [suggested('open_rfqs', getState())] })
      return
    }
    const o = toolCompare(reqId)
    pushChat(reqId, { role: 'agent', text: say(o), actions: [suggested('open_compare', getState())] })
    return
  }

  if (/rfq|อีเมล|email|ร่าง|draft|หา|find|supplier|ผู้ขาย|ซัพ|ใบเสนอราคา|quote/.test(t) || req.status === 'new') {
    const a = toolFindSuppliers(reqId)
    pushChat(reqId, { role: 'tool', toolName: 'find_suppliers', text: say(a) })
    const b = toolDraftRfqs(reqId)
    pushChat(reqId, {
      role: 'agent',
      text: th
        ? `${say(b)}\nตรวจอีเมลในแท็บ "ขอใบเสนอราคา" แก้ได้ทุกฉบับ แล้วกด "ส่งทั้งหมด"`
        : `${say(b)}\nCheck them in the RFQs tab, edit any you like, then press Send all.`,
      actions: [suggested('open_rfqs', getState())]
    })
    return
  }

  pushChat(reqId, {
    role: 'agent',
    text: th
      ? 'ผมช่วยได้: หาผู้ขายและร่าง RFQ, เปรียบเทียบใบเสนอราคา, ปรับวันที่ต้องการ (เช่น "ส่งภายใน 2 สัปดาห์") หรือวางรายการใหม่ทีละบรรทัด'
      : 'I can find suppliers and draft RFQs, compare quotes, change the need-by date (e.g. "deliver within 2 weeks"), or add items you paste one per line.',
    actions: nextActions(req.status, req.rfqs.some((r) => r.status === 'draft'))
  })
}

export const _test = { scripted, bi }
