// Shared data model for Sourcing Desk (main + renderer).

export type Lang = 'th' | 'en'
export type Role = 'buyer' | 'head'

export type RequestStatus = 'new' | 'rfq_sent' | 'quotes_in' | 'ready' | 'po_issued'
export const STATUS_ORDER: RequestStatus[] = ['new', 'rfq_sent', 'quotes_in', 'ready', 'po_issued']

export interface Part {
  id: string
  partNo: string
  name: string
  spec: string
  qty: number
  unit: string
  needBy: string // ISO date
  standardPrice?: number // THB per unit, from the item master
  category?: string
}

export interface SupplierProfile {
  priceFactor: number // multiplier on the market price (1 = market)
  leadDays: number
  moq: number
  paymentDays: number
  replyHours: number // simulated reply delay (in demo minutes it is scaled down)
}

export interface Supplier {
  id: string
  name: string
  contact: string
  email: string
  phone: string
  province: string
  categories: string[]
  known: boolean // already in the company's supplier list
  verified: boolean // audited by the company
  lastPrices: Record<string, number> // partNo -> last THB/unit
  notes: string
  profile: SupplierProfile
  source: 'company' | 'search'
}

export interface Rfq {
  id: string
  supplierId: string
  partIds: string[]
  subject: string
  body: string
  status: 'draft' | 'sent' | 'replied' | 'no_reply'
  sentAt?: string
  repliedAt?: string
}

export interface Quote {
  id: string
  rfqId: string
  supplierId: string
  partId: string
  unitPrice: number
  moq: number
  leadDays: number
  paymentDays: number
  validityDays: number
  receivedAt: string
  sourceMailId: string
}

export interface Bi {
  th: string
  en: string
}

export interface FactorReason {
  factor: 'price' | 'lead' | 'payment' | 'moq' | 'trust'
  text: Bi
  good: boolean
}

export interface Pick {
  partId: string
  supplierId: string
  quoteId: string
  score: number
  reasons: FactorReason[]
  band: 'inside' | 'above' | 'below' | 'no_standard'
  overridden?: boolean
}

export type ApprovalState = 'none' | 'buyer_approved' | 'awaiting_head' | 'head_approved' | 'head_rejected'

export interface PoLine {
  partId: string
  supplierId: string
  qty: number
  unitPrice: number
}

export interface PurchaseOrder {
  number: string
  supplierId: string
  lines: PoLine[]
  createdAt: string
  total: number
  checks: { ok: boolean; text: Bi }[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'tool'
  text: string
  at: string
  toolName?: string
  actions?: SuggestedAction[]
}

export type SuggestedActionKind = 'find_suppliers' | 'draft_rfqs' | 'open_rfqs' | 'check_mail' | 'compare' | 'open_compare' | 'draft_po'
export interface SuggestedAction {
  kind: SuggestedActionKind
  label: string
}

export interface AuditEntry {
  at: string
  who: 'agent' | 'buyer' | 'head' | 'system'
  text: Bi
}

export interface PurchaseRequest {
  id: string
  title: string
  createdAt: string
  needBy: string
  status: RequestStatus
  parts: Part[]
  candidates: Record<string, string[]> // partId -> supplierIds
  rfqs: Rfq[]
  quotes: Quote[]
  picks: Pick[]
  approval: ApprovalState
  approvalNote?: string
  pos: PurchaseOrder[]
  chat: ChatMessage[]
  log: AuditEntry[]
}

export interface Mail {
  id: string
  direction: 'out' | 'in'
  supplierId: string
  requestId: string
  rfqId: string
  subject: string
  body: string
  at: string
  attachmentName?: string
  delivered: boolean // false while a simulated reply is still on its way
}

export interface Settings {
  lang: Lang
  role: Role
  companyName: string
  buyerName: string
  headName: string
  apiBaseUrl: string // OpenAI-compatible, e.g. https://api.example.com/v1
  apiKey: string
  model: string
  bandLowPct: number // e.g. 10 => -10%
  bandHighPct: number // e.g. 20 => +20%
  replySpeed: 'instant' | 'fast' | 'realistic'
}

export interface AppState {
  settings: Settings
  requests: PurchaseRequest[]
  suppliers: Supplier[]
  mailbox: Mail[]
  notifications: { id: string; at: string; text: Bi; requestId?: string; read: boolean }[]
  seq: { request: number; po: number }
}

export interface AgentStep {
  tool: string
  summary: string
}

export interface AgentResult {
  state: AppState
  reply: string
  steps: AgentStep[]
  actions: SuggestedAction[]
}
