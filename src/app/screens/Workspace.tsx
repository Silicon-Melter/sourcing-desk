import { useEffect, useRef, useState } from 'react'
import type { PurchaseRequest, SuggestedAction } from '@shared/types'
import { STATUS_ORDER } from '@shared/types'
import { fmtMoney, scoreQuotes } from '@shared/logic'
import { fmtDate, fmtTime, statusLabel, t } from '../i18n'
import {
  buyerApprove, choosePick, discardRfq, editRfq, findReq, getState, pushChat, removePart, sendRfqs, toolCompare, toolDraftRfqs,
  toolFindSuppliers, updatePart, useApp
} from '../store'
import { imagesSupported, runAgent, type AiStatus, type RunHandle } from '../agent'
import { poWorkbook, saveFile } from '../files'
import { Icon } from '../components/Icon'

type Tab = 'parts' | 'rfq' | 'compare' | 'po' | 'log'

export function Workspace({ reqId, onBack, onAi, toast }: { reqId: string; onBack: () => void; onAi: (s: AiStatus) => void; toast: (m: string) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const req = s.requests.find((r) => r.id === reqId)
  const [tab, setTab] = useState<Tab>('parts')
  const lastStatus = useRef(req?.status)

  // Follow the work: jump to the tab where the next human step is.
  useEffect(() => {
    if (!req || req.status === lastStatus.current) return
    lastStatus.current = req.status
    if (req.status === 'ready') setTab('compare')
    if (req.status === 'po_issued') setTab('po')
  }, [req?.status])
  const draftCount = req?.rfqs.filter((r) => r.status === 'draft').length ?? 0
  const lastDrafts = useRef(draftCount)
  useEffect(() => {
    if (draftCount > lastDrafts.current) setTab('rfq')
    lastDrafts.current = draftCount
  }, [draftCount])

  if (!req) return <div className="page empty">{lang === 'th' ? 'ไม่พบใบขอซื้อ' : 'Request not found'}</div>

  const doAction = (a: SuggestedAction) => {
    if (a.kind === 'find_suppliers') {
      const o1 = toolFindSuppliers(reqId)
      pushChat(reqId, { role: 'tool', toolName: 'find_suppliers', text: o1.summary[lang] })
      const o2 = toolDraftRfqs(reqId)
      pushChat(reqId, {
        role: 'agent',
        text: lang === 'th' ? `${o2.summary.th}\nตรวจและแก้ไขได้ในแท็บ "ขอใบเสนอราคา" แล้วกด "ส่งทั้งหมด"` : `${o2.summary.en}\nReview and edit them in the RFQs tab, then press Send all.`
      })
      setTab('rfq')
    }
    if (a.kind === 'draft_rfqs') {
      toolDraftRfqs(reqId)
      setTab('rfq')
    }
    if (a.kind === 'open_rfqs') setTab('rfq')
    if (a.kind === 'compare') {
      toolCompare(reqId)
      setTab('compare')
    }
    if (a.kind === 'open_compare') setTab('compare')
    if (a.kind === 'draft_po') setTab('po')
  }

  const drafts = req.rfqs.filter((r) => r.status === 'draft').length
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'parts', label: t(lang, 'tabParts'), count: req.parts.length },
    { id: 'rfq', label: t(lang, 'tabRfq'), count: req.rfqs.length || undefined },
    { id: 'compare', label: t(lang, 'tabCompare'), count: req.quotes.length || undefined },
    { id: 'po', label: t(lang, 'tabPo'), count: req.pos.length || undefined },
    { id: 'log', label: t(lang, 'tabLog') }
  ]
  const stepIdx = STATUS_ORDER.indexOf(req.status)

  return (
    <div className="ws">
      <Chat req={req} onAction={doAction} onAi={onAi} />
      <section className="work" aria-label={req.title}>
        <div className="wshead">
          <div className="head">
            <button className="btn ghost sm" onClick={onBack} aria-label={t(lang, 'back')}>
              <Icon name="back" />
            </button>
            <span className="mono muted">{req.id}</span>
            <h1>{req.title}</h1>
            <span className="grow" />
            <span className="small muted">
              {t(lang, 'needBy')} {fmtDate(lang, req.needBy)}
            </span>
          </div>
          <div className="steps" aria-label="Status">
            {STATUS_ORDER.map((st, i) => (
              <span key={st} className={i < stepIdx ? 'done' : i === stepIdx ? 'now' : ''}>
                {statusLabel(lang, st)}
              </span>
            ))}
          </div>
          <div className="tabs" role="tablist">
            {tabs.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
                {x.label}
                {x.count ? <span className="count">{x.count}</span> : null}
                {x.id === 'rfq' && drafts > 0 ? <span className="count" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>{drafts}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="tabbody" role="tabpanel">
          {tab === 'parts' && <PartsTab req={req} onAction={doAction} />}
          {tab === 'rfq' && <RfqTab req={req} onAction={doAction} />}
          {tab === 'compare' && <CompareTab req={req} onAction={doAction} goPo={() => setTab('po')} />}
          {tab === 'po' && <PoTab req={req} toast={toast} />}
          {tab === 'log' && <LogTab req={req} />}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- chat

function Chat({ req, onAction, onAi }: { req: PurchaseRequest; onAction: (a: SuggestedAction) => void; onAi: (s: AiStatus) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [live, setLive] = useState<string | null>(null)
  const [run, setRun] = useState<RunHandle | null>(null)
  const [canImg, setCanImg] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    imagesSupported().then(setCanImg)
  }, [])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [req.chat.length, live])

  function send() {
    if (run || (!text.trim() && files.length === 0)) return
    const h = runAgent(req.id, text.trim(), files, setLive, onAi)
    setRun(h)
    setText('')
    setFiles([])
    h.done.finally(() => setRun(null))
  }

  return (
    <aside className="chat" aria-label={t(lang, 'agent')}>
      <div className="log" ref={logRef} aria-live="polite">
        {req.chat.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.text}
            {m.actions && m.actions.length > 0 && (
              <div className="acts">
                {m.actions.map((a, i) => (
                  <button key={i} className="btn sm" onClick={() => onAction(a)}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {m.role !== 'tool' && <time>{fmtTime(lang, m.at)}</time>}
          </div>
        ))}
        {live !== null && <div className="msg agent">{live || t(lang, 'thinking')}</div>}
      </div>
      <div className="composer">
        <textarea
          id="agent-input"
          value={text}
          placeholder={t(lang, 'askPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          onPaste={(e) => {
            const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (imgs.length && canImg) setFiles((x) => [...x, ...imgs].slice(0, 4))
          }}
        />
        <div className="row">
          {canImg && (
            <>
              <button className="btn ghost sm" onClick={() => fileRef.current?.click()} title={t(lang, 'attachPhoto')} aria-label={t(lang, 'attachPhoto')}>
                <Icon name="clip" />
              </button>
              <input id="agent-photo" ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 4))} />
            </>
          )}
          <span className="grow">{files.map((f) => f.name).join(', ')}</span>
          {run ? (
            <button className="btn" onClick={() => run.stop()}>
              {t(lang, 'stop')}
            </button>
          ) : (
            <button className="btn primary" onClick={send} disabled={!text.trim() && files.length === 0}>
              <Icon name="send" /> {t(lang, 'send')}
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------- parts

function PartsTab({ req, onAction }: { req: PurchaseRequest; onAction: (a: SuggestedAction) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const [editing, setEditing] = useState(false)
  const sName = (id: string) => s.suppliers.find((x) => x.id === id)
  const locked = req.status !== 'new'

  return (
    <>
      <div className="head">
        <span className="small muted">
          {req.parts.length} {t(lang, 'parts')}
        </span>
        <span className="grow" />
        {!locked && (
          <button className="btn sm" onClick={() => setEditing((x) => !x)}>
            {t(lang, editing ? 'done' : 'edit')}
          </button>
        )}
        {req.status === 'new' && (
          <button className="btn primary sm" onClick={() => onAction({ kind: 'find_suppliers', label: '' })}>
            {t(lang, 'findSuppliers')}
          </button>
        )}
      </div>
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t(lang, 'partNo')}</th>
              <th>{t(lang, 'item')}</th>
              <th className="num">{t(lang, 'qty')}</th>
              <th>{t(lang, 'unit')}</th>
              <th className="num">{t(lang, 'stdPrice')} (฿)</th>
              <th>{t(lang, 'needBy')}</th>
              <th>{t(lang, 'suppliersFound')}</th>
              {editing && <th />}
            </tr>
          </thead>
          <tbody>
            {req.parts.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.partNo}</td>
                <td>
                  {p.name}
                  {p.spec && <div className="small muted">{p.spec}</div>}
                </td>
                <td className="num">
                  {editing ? <input id={`qty-${p.id}`} type="number" value={p.qty} onChange={(e) => updatePart(req.id, p.id, { qty: Number(e.target.value) })} /> : p.qty.toLocaleString()}
                </td>
                <td>{p.unit}</td>
                <td className="num">
                  {editing ? (
                    <input id={`std-${p.id}`} type="number" value={p.standardPrice ?? ''} onChange={(e) => updatePart(req.id, p.id, { standardPrice: Number(e.target.value) || undefined })} />
                  ) : p.standardPrice !== undefined ? (
                    fmtMoney(p.standardPrice)
                  ) : (
                    <span className="chip warn">{t(lang, 'bandNone')}</span>
                  )}
                </td>
                <td>
                  {editing ? <input id={`need-${p.id}`} type="date" value={p.needBy} onChange={(e) => updatePart(req.id, p.id, { needBy: e.target.value })} /> : fmtDate(lang, p.needBy)}
                </td>
                <td>
                  {(req.candidates[p.id] ?? []).length === 0 ? (
                    <span className="small muted">{t(lang, 'noCandidates')}</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {req.candidates[p.id].map((id) => {
                        const sp = sName(id)
                        return (
                          <span key={id} className={`chip ${sp?.known ? '' : 'accent'}`} title={sp?.known ? t(lang, 'known') : t(lang, 'newSupplier')}>
                            {sp?.name.split(' ').slice(0, 2).join(' ')}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </td>
                {editing && (
                  <td>
                    <button className="btn ghost sm danger" onClick={() => removePart(req.id, p.id)} aria-label="Remove">
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {lang === 'th'
          ? 'ราคากลางมาจากทะเบียนวัสดุของบริษัท ใช้ตรวจกรอบราคา (PPV) ตอนเลือกผู้ขาย'
          : 'Standard prices come from the item master and set the price band (PPV) used when picking suppliers.'}
      </p>
    </>
  )
}

// ---------------------------------------------------------------- RFQs

function RfqTab({ req, onAction }: { req: PurchaseRequest; onAction: (a: SuggestedAction) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const drafts = req.rfqs.filter((r) => r.status === 'draft')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => setSel(new Set(drafts.map((d) => d.id))), [drafts.length])

  if (req.rfqs.length === 0)
    return (
      <div className="panel empty">
        <p>{t(lang, 'noRfqs')}</p>
        <button className="btn primary" onClick={() => onAction({ kind: 'find_suppliers', label: '' })}>
          {t(lang, 'findSuppliers')}
        </button>
      </div>
    )

  const chip = (st: string) =>
    st === 'draft' ? <span className="chip accent">{t(lang, 'rfqDraft')}</span> : st === 'sent' ? <span className="chip">{t(lang, 'rfqSent')}</span> : st === 'replied' ? <span className="chip good">{t(lang, 'rfqReplied')}</span> : <span className="chip warn">{t(lang, 'rfqNoReply')}</span>

  return (
    <>
      {drafts.length > 0 && (
        <div className="panel approve-bar">
          <div className="grow">
            <strong>{lang === 'th' ? `ร่างอีเมล ${drafts.length} ฉบับ รอคุณตรวจ` : `${drafts.length} drafts waiting for your check`}</strong>
            <div className="small muted">{lang === 'th' ? 'ผู้ช่วยส่งอีเมลเองไม่ได้ ต้องกดส่งจากที่นี่' : 'The agent cannot send email by itself; send from here.'}</div>
          </div>
          <button className="btn primary" disabled={sel.size === 0} onClick={() => sendRfqs(req.id, [...sel])}>
            <Icon name="send" /> {sel.size === drafts.length ? t(lang, 'sendAll') : t(lang, 'sendSelected')} ({sel.size})
          </button>
        </div>
      )}
      <div className="rfqs">
        {req.rfqs.map((r) => {
          const sp = s.suppliers.find((x) => x.id === r.supplierId)!
          const isDraft = r.status === 'draft'
          return (
            <article className="panel rfq" key={r.id}>
              <header>
                <label>
                  {isDraft && (
                    <input
                      id={`sel-${r.id}`}
                      type="checkbox"
                      checked={sel.has(r.id)}
                      onChange={(e) => {
                        const n = new Set(sel)
                        if (e.target.checked) n.add(r.id)
                        else n.delete(r.id)
                        setSel(n)
                      }}
                    />
                  )}
                  <span>{sp.name}</span>
                </label>
                {!sp.known && <span className="chip accent">{t(lang, 'newSupplier')}</span>}
                {chip(r.status)}
              </header>
              <div className="to">
                {t(lang, 'to')}: {sp.email} · {r.partIds.length} {t(lang, 'parts')}
              </div>
              {isDraft ? (
                open === r.id ? (
                  <>
                    <input id={`subj-${r.id}`} className="subj" value={r.subject} onChange={(e) => editRfq(req.id, r.id, { subject: e.target.value })} aria-label={t(lang, 'subject')} />
                    <textarea id={`body-${r.id}`} value={r.body} onChange={(e) => editRfq(req.id, r.id, { body: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn sm" onClick={() => setOpen(null)}>
                        {t(lang, 'done')}
                      </button>
                      <button className="btn ghost sm danger" onClick={() => discardRfq(req.id, r.id)}>
                        {lang === 'th' ? 'ไม่ส่งรายนี้' : 'Drop this one'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <strong className="small">{r.subject}</strong>
                    <pre>{r.body}</pre>
                    <div>
                      <button className="btn sm" onClick={() => setOpen(r.id)}>
                        {t(lang, 'edit')}
                      </button>
                    </div>
                  </>
                )
              ) : (
                <>
                  <strong className="small">{r.subject}</strong>
                  <div className="small muted">
                    {r.sentAt && `${t(lang, 'rfqSent')} ${fmtTime(lang, r.sentAt)}`}
                    {r.repliedAt && ` · ${t(lang, 'rfqReplied')} ${fmtTime(lang, r.repliedAt)}`}
                  </div>
                </>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- comparison

function bandChip(lang: 'th' | 'en', band: string) {
  if (band === 'inside') return <span className="chip good">{t(lang, 'bandInside')}</span>
  if (band === 'above') return <span className="chip bad">{t(lang, 'bandAbove')}</span>
  if (band === 'below') return <span className="chip warn">{t(lang, 'bandBelow')}</span>
  return <span className="chip">{t(lang, 'bandNone')}</span>
}

function CompareTab({ req, onAction, goPo }: { req: PurchaseRequest; onAction: (a: SuggestedAction) => void; goPo: () => void }) {
  const s = useApp()
  const lang = s.settings.lang
  if (req.quotes.length === 0) return <div className="panel empty">{t(lang, 'noQuotes')}</div>
  const above = req.picks.filter((p) => p.band === 'above').length
  const pending = req.rfqs.filter((r) => r.status === 'sent').length
  const locked = req.approval === 'awaiting_head' || req.status === 'po_issued'
  const total = req.picks.reduce((a, p) => {
    const q = req.quotes.find((x) => x.id === p.quoteId)
    const part = req.parts.find((x) => x.id === p.partId)
    return a + (q && part ? q.unitPrice * Math.max(part.qty, q.moq) : 0)
  }, 0)

  return (
    <>
      <div className="panel approve-bar">
        <div className="grow">
          <strong>
            {lang === 'th' ? `เลือกแล้ว ${req.picks.length}/${req.parts.length} รายการ · รวม ${fmtMoney(total)} บาท` : `${req.picks.length}/${req.parts.length} parts picked · THB ${fmtMoney(total)}`}
          </strong>
          <div className="small muted">
            {pending > 0 && (lang === 'th' ? `รออีก ${pending} ราย · ` : `${pending} still to reply · `)}
            {above > 0 ? t(lang, 'whyApproval') : t(lang, 'bandInside')}
          </div>
        </div>
        {pending > 0 && (
          <button className="btn" onClick={() => onAction({ kind: 'compare', label: '' })}>
            {t(lang, 'compareNow')}
          </button>
        )}
        {req.approval === 'awaiting_head' ? (
          <span className="chip warn">{t(lang, 'awaitingHead')}</span>
        ) : req.status === 'po_issued' ? (
          <button className="btn" onClick={goPo}>
            {t(lang, 'tabPo')}
          </button>
        ) : (
          <button className="btn primary" disabled={req.picks.length === 0} onClick={() => buyerApprove(req.id)}>
            {above > 0 ? t(lang, 'sendToHead') : t(lang, 'approvePo')}
          </button>
        )}
      </div>
      {req.approval === 'head_rejected' && (
        <div className="panel approve-bar" style={{ borderColor: 'var(--bad)' }}>
          <span className="chip bad">{t(lang, 'headRejected')}</span>
          <span>{req.approvalNote}</span>
        </div>
      )}
      {req.parts.map((part) => {
        const scored = scoreQuotes(part, req.quotes, s.suppliers)
        const pick = req.picks.find((p) => p.partId === part.id)
        return (
          <section className="part-block" key={part.id}>
            <h3>
              <span className="mono">{part.partNo}</span>
              <span>{part.name}</span>
              <span className="small muted">
                {part.qty.toLocaleString()} {part.unit} · {t(lang, 'stdPrice')} {part.standardPrice !== undefined ? fmtMoney(part.standardPrice) : '–'}
              </span>
              {pick && bandChip(lang, pick.band)}
            </h3>
            {scored.length === 0 ? (
              <div className="small muted">{lang === 'th' ? 'ยังไม่มีใบเสนอราคาสำหรับรายการนี้' : 'No quotes for this part yet'}</div>
            ) : (
              <div className="tablewrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>{t(lang, 'supplier')}</th>
                      <th className="num">{t(lang, 'unitPrice')}</th>
                      <th className="num">MOQ</th>
                      <th className="num">{t(lang, 'lead')}</th>
                      <th className="num">{t(lang, 'payment')}</th>
                      <th className="num">{t(lang, 'validity')}</th>
                      <th className="num">{t(lang, 'score')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {scored.map((x) => {
                      const sp = s.suppliers.find((y) => y.id === x.quote.supplierId)!
                      const chosen = pick?.quoteId === x.quote.id
                      return (
                        <tr key={x.quote.id} className={chosen ? 'best' : ''}>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              <span>{sp.name}</span>
                              {!sp.verified && <span className="chip accent">{t(lang, 'newSupplier')}</span>}
                              {x.late && <span className="chip bad">{t(lang, 'late')}</span>}
                            </div>
                          </td>
                          <td className="num">{fmtMoney(x.quote.unitPrice)}</td>
                          <td className="num">{x.quote.moq.toLocaleString()}</td>
                          <td className="num">
                            {x.quote.leadDays} {t(lang, 'days')}
                          </td>
                          <td className="num">{x.quote.paymentDays === 0 ? (lang === 'th' ? 'เงินสด' : 'cash') : `${x.quote.paymentDays} ${t(lang, 'days')}`}</td>
                          <td className="num">
                            {x.quote.validityDays} {t(lang, 'days')}
                          </td>
                          <td className="num">{x.score.toFixed(2)}</td>
                          <td>
                            {chosen ? (
                              <span className="chip good">{pick?.overridden ? t(lang, 'chosen') : t(lang, 'recommended')}</span>
                            ) : (
                              <button className="btn sm" disabled={locked} onClick={() => choosePick(req.id, part.id, x.quote.id)}>
                                {t(lang, 'pickThis')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pick && (
              <div className="reasons">
                <strong className="small" style={{ marginRight: 4 }}>
                  {t(lang, 'reasons')}:
                </strong>
                {pick.reasons.map((r) => (
                  <span key={r.factor} className={r.good ? '' : 'bad'}>
                    {r.text[lang]}
                  </span>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------- PO

function PoTab({ req, toast }: { req: PurchaseRequest; toast: (m: string) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  if (req.pos.length === 0)
    return (
      <div className="panel empty">
        {req.approval === 'awaiting_head' ? (
          <>
            <p>{t(lang, 'awaitingHead')}</p>
            <p className="small">{lang === 'th' ? 'สลับมุมมองเป็น "หัวหน้าจัดซื้อ" ที่แถบด้านซ้าย แล้วเปิดเมนู "รออนุมัติ"' : 'Switch the view to "Purchasing head" in the sidebar, then open Approvals.'}</p>
          </>
        ) : (
          t(lang, 'noPo')
        )}
      </div>
    )
  const status =
    req.approval === 'head_approved' ? <span className="chip good">{t(lang, 'headApproved')}</span> : <span className="chip good">{lang === 'th' ? 'ผู้ซื้ออนุมัติ' : 'Approved by the buyer'}</span>

  async function download(num: string) {
    const st = getState()
    const r = findReq(st, req.id)
    const po = r.pos.find((p) => p.number === num)!
    const res = await saveFile(`${po.number}.xlsx`, poWorkbook(po, r, st))
    if (res === 'saved') toast(lang === 'th' ? `บันทึก ${po.number}.xlsx แล้ว` : `Saved ${po.number}.xlsx`)
    if (res === 'unavailable') toast(lang === 'th' ? 'ดาวน์โหลดไม่ได้ในหน้านี้' : 'Downloads are not available here')
  }

  return (
    <>
      <div className="head">
        {status}
        <span className="small muted">{lang === 'th' ? 'ร่าง PO พร้อมส่งให้ผู้ขาย' : 'PO drafts ready to send to suppliers'}</span>
      </div>
      {req.pos.map((po) => {
        const sp = s.suppliers.find((x) => x.id === po.supplierId)!
        return (
          <article className="panel po" key={po.number}>
            <header>
              <h3 className="mono">{po.number}</h3>
              <span>{sp.name}</span>
              <span className="grow" style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => download(po.number)}>
                <Icon name="download" /> {t(lang, 'downloadPo')}
              </button>
            </header>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>{t(lang, 'partNo')}</th>
                    <th>{t(lang, 'item')}</th>
                    <th className="num">{t(lang, 'qty')}</th>
                    <th className="num">{t(lang, 'unitPrice')}</th>
                    <th className="num">{t(lang, 'total')} (฿)</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l) => {
                    const p = req.parts.find((x) => x.id === l.partId)!
                    return (
                      <tr key={l.partId}>
                        <td className="mono">{p.partNo}</td>
                        <td>{p.name}</td>
                        <td className="num">
                          {l.qty.toLocaleString()} {p.unit}
                        </td>
                        <td className="num">{fmtMoney(l.unitPrice)}</td>
                        <td className="num">{fmtMoney(l.qty * l.unitPrice)}</td>
                      </tr>
                    )
                  })}
                  <tr>
                    <td colSpan={4} className="num">
                      <strong>{t(lang, 'total')}</strong> <span className="small muted">({t(lang, 'vatNote')})</span>
                    </td>
                    <td className="num">
                      <strong>{fmtMoney(po.total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <strong className="small">{t(lang, 'poChecks')}</strong>
              <div className="checks">
                {po.checks.map((c, i) => (
                  <span key={i} className={c.ok ? '' : 'bad'}>
                    {c.text[lang]}
                  </span>
                ))}
              </div>
            </div>
          </article>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------- audit log

function LogTab({ req }: { req: PurchaseRequest }) {
  const s = useApp()
  const lang = s.settings.lang
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr>
            <th>{lang === 'th' ? 'เวลา' : 'Time'}</th>
            <th>{lang === 'th' ? 'ผู้ทำ' : 'Who'}</th>
            <th>{lang === 'th' ? 'สิ่งที่ทำ' : 'What'}</th>
          </tr>
        </thead>
        <tbody>
          {[...req.log].reverse().map((e, i) => (
            <tr key={i}>
              <td className="num mono">
                {fmtDate(lang, e.at)} {fmtTime(lang, e.at)}
              </td>
              <td>
                <span className={`chip ${e.who === 'agent' ? 'accent' : e.who === 'head' ? 'warn' : ''}`}>{t(lang, `who_${e.who}`)}</span>
              </td>
              <td>{e.text[lang]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
