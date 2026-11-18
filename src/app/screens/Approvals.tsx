import { useState } from 'react'
import { fmtMoney } from '@shared/logic'
import { fmtDate, t } from '../i18n'
import { headDecide, update, useApp } from '../store'

export function Approvals({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const waiting = s.requests.filter((r) => r.approval === 'awaiting_head')
  const isHead = s.settings.role === 'head'
  const [notes, setNotes] = useState<Record<string, string>>({})

  return (
    <div className="page">
      <div className="head">
        <h1>{t(lang, 'navApprovals')}</h1>
        <span className="sub">{lang === 'th' ? 'เฉพาะรายการที่ราคาเกินกรอบเท่านั้นที่มาถึงหัวหน้า' : 'Only picks above the price band reach the head'}</span>
      </div>
      {!isHead && waiting.length > 0 && (
        <div className="panel approve-bar">
          <span className="grow">{lang === 'th' ? 'คุณกำลังดูในฐานะเจ้าหน้าที่จัดซื้อ สลับเป็นหัวหน้าเพื่ออนุมัติ' : 'You are viewing as the buyer. Switch to the head to approve.'}</span>
          <button className="btn primary" onClick={() => update((d) => void (d.settings.role = 'head'))}>
            {lang === 'th' ? 'สลับเป็นหัวหน้าจัดซื้อ' : 'Switch to purchasing head'}
          </button>
        </div>
      )}
      {waiting.length === 0 && <div className="panel empty">{t(lang, 'noApprovals')}</div>}
      {waiting.map((r) => {
        const rows = r.picks.map((p) => {
          const part = r.parts.find((x) => x.id === p.partId)!
          const q = r.quotes.find((x) => x.id === p.quoteId)!
          const sp = s.suppliers.find((x) => x.id === p.supplierId)!
          const diff = part.standardPrice ? Math.round((q.unitPrice / part.standardPrice - 1) * 100) : null
          return { p, part, q, sp, diff }
        })
        const flagged = rows.filter((x) => x.p.band === 'above')
        const total = rows.reduce((a, x) => a + x.q.unitPrice * Math.max(x.part.qty, x.q.moq), 0)
        return (
          <article className="panel" key={r.id} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="head">
              <span className="mono muted">{r.id}</span>
              <h1 style={{ fontSize: 16 }}>{r.title}</h1>
              <span className="chip warn">{t(lang, 'awaitingHead')}</span>
              <span className="grow" />
              <button className="btn sm" onClick={() => onOpen(r.id)}>
                {t(lang, 'open')}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div className="line-mock" aria-label={t(lang, 'lineMock')}>
                <b>LINE · Sourcing Desk</b>
                <span>
                  {lang === 'th'
                    ? `${r.id} รออนุมัติ: ${flagged.map((x) => `${x.part.partNo} จาก ${x.sp.name} ราคา ${fmtMoney(x.q.unitPrice)} บาท (สูงกว่าราคากลาง ${x.diff}%)`).join('; ')} ยอดรวม ${fmtMoney(total)} บาท`
                    : `${r.id} needs approval: ${flagged.map((x) => `${x.part.partNo} from ${x.sp.name} at THB ${fmtMoney(x.q.unitPrice)} (${x.diff}% above standard)`).join('; ')}. Total THB ${fmtMoney(total)}.`}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 260 }} className="small muted">
                {t(lang, 'lineMock')}
              </div>
            </div>
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>{t(lang, 'partNo')}</th>
                    <th>{t(lang, 'supplier')}</th>
                    <th className="num">{t(lang, 'unitPrice')}</th>
                    <th className="num">{t(lang, 'stdPrice')}</th>
                    <th className="num">±%</th>
                    <th>{t(lang, 'reasons')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, part, q, sp, diff }) => (
                    <tr key={p.partId} className={p.band === 'above' ? 'best' : ''}>
                      <td className="mono">{part.partNo}</td>
                      <td>{sp.name}</td>
                      <td className="num">{fmtMoney(q.unitPrice)}</td>
                      <td className="num">{part.standardPrice ? fmtMoney(part.standardPrice) : '–'}</td>
                      <td className="num">{diff === null ? '–' : <span className={`chip ${p.band === 'above' ? 'bad' : 'good'}`}>{diff > 0 ? '+' : ''}{diff}%</span>}</td>
                      <td className="small">{p.reasons.filter((x) => x.factor === 'lead' || !x.good).map((x) => x.text[lang]).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small muted">
              {t(lang, 'needBy')} {fmtDate(lang, r.needBy)} · {t(lang, 'total')} {fmtMoney(total)} ฿ ({t(lang, 'vatNote')})
            </div>
            {isHead && (
              <div className="approve-bar" style={{ padding: 0 }}>
                <input
                  id={`note-${r.id}`}
                  className="grow"
                  style={{ border: '1px solid var(--line-strong)', borderRadius: 6, padding: '6px 10px', background: 'var(--raise)' }}
                  placeholder={t(lang, 'rejectNote')}
                  value={notes[r.id] ?? ''}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                />
                <button className="btn danger" onClick={() => headDecide(r.id, false, notes[r.id] ?? '')}>
                  {t(lang, 'reject')}
                </button>
                <button className="btn primary" onClick={() => headDecide(r.id, true, notes[r.id] ?? '')}>
                  {t(lang, 'approve')}
                </button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
