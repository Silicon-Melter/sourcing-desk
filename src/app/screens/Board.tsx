import { useState } from 'react'
import { STATUS_ORDER } from '@shared/types'
import { daysBetween } from '@shared/logic'
import { fmtDate, statusLabel, t } from '../i18n'
import { createSampleRequest, markNotificationsRead, useApp } from '../store'
import { IntakeModal } from '../components/IntakeModal'
import { Icon } from '../components/Icon'

export function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const [intake, setIntake] = useState(false)
  const unread = s.notifications.filter((n) => !n.read)

  return (
    <div className="page">
      <div className="head">
        <h1>{t(lang, 'navRequests')}</h1>
        <span className="chip warn">{t(lang, 'sampleBadge')}</span>
        <span className="grow" />
        <button className="btn" onClick={() => onOpen(createSampleRequest())}>
          {t(lang, 'loadSample')}
        </button>
        <button className="btn primary" onClick={() => setIntake(true)}>
          <Icon name="plus" /> {t(lang, 'newRequest')}
        </button>
      </div>

      {unread.length > 0 && (
        <div className="notes" aria-label={t(lang, 'notifications')}>
          {unread.slice(0, 3).map((n) => (
            <button
              key={n.id}
              className="unread"
              onClick={() => {
                markNotificationsRead()
                if (n.requestId) onOpen(n.requestId)
              }}
            >
              <span className="dot on" style={{ marginTop: 6 }} />
              <span>{n.text[lang]}</span>
            </button>
          ))}
        </div>
      )}

      {s.requests.length === 0 ? (
        <div className="start">
          <div className="panel">
            <h3>{t(lang, 'loadSample')}</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {lang === 'th'
                ? 'BOM ตัวอย่าง 6 รายการ (ลูกปืน สกรู แผ่นเหล็ก โอริง สีฝุ่น สายไฟ) กับผู้ขายตัวอย่าง 12 ราย ที่ตอบอีเมลเองอัตโนมัติ'
                : 'A sample BOM of 6 parts (bearings, bolts, steel sheet, O-rings, powder paint, cable) and 12 sample suppliers who answer email on their own.'}
            </p>
            <div>
              <button className="btn primary" onClick={() => onOpen(createSampleRequest())}>
                {t(lang, 'loadSample')}
              </button>
            </div>
          </div>
          <div className="panel">
            <h3>{t(lang, 'newRequest')}</h3>
            <p className="muted small" style={{ margin: 0 }}>
              {lang === 'th' ? 'อัปโหลด BOM หรือไฟล์ MRP เป็น Excel/CSV หรือวางรายการจาก LINE' : 'Upload a BOM or MRP export as Excel/CSV, or paste items from LINE.'}
            </p>
            <div>
              <button className="btn" onClick={() => setIntake(true)}>
                <Icon name="upload" /> {t(lang, 'newRequest')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="board">
          {STATUS_ORDER.map((st) => {
            const items = s.requests.filter((r) => r.status === st)
            return (
              <section className="col" key={st} aria-label={statusLabel(lang, st)}>
                <h2>
                  <span>{statusLabel(lang, st)}</span>
                  <span>{items.length}</span>
                </h2>
                {items.length === 0 && <div className="small muted" style={{ padding: '4px 2px' }}>{t(lang, 'emptyColumn')}</div>}
                {items.map((r) => {
                  const left = daysBetween(new Date().toISOString(), r.needBy)
                  const above = r.picks.some((p) => p.band === 'above')
                  return (
                    <button className="card" key={r.id} onClick={() => onOpen(r.id)}>
                      <span className="id">{r.id}</span>
                      <span className="title">{r.title}</span>
                      <span className="meta">
                        <span>
                          {r.parts.length} {t(lang, 'parts')}
                        </span>
                        <span>·</span>
                        <span>
                          {t(lang, 'needBy')} {fmtDate(lang, r.needBy)}
                        </span>
                      </span>
                      <span className="meta">
                        {left <= 5 && r.status !== 'po_issued' && <span className="chip bad">{lang === 'th' ? `เหลือ ${left} วัน` : `${left} days left`}</span>}
                        {r.approval === 'awaiting_head' && <span className="chip warn">{t(lang, 'awaitingHead')}</span>}
                        {above && r.approval === 'none' && <span className="chip warn">{t(lang, 'bandAbove')}</span>}
                        {r.status === 'rfq_sent' && (
                          <span className="chip">
                            {r.rfqs.filter((x) => x.status === 'replied').length}/{r.rfqs.filter((x) => x.status !== 'draft').length} {t(lang, 'rfqReplied')}
                          </span>
                        )}
                        {r.status === 'po_issued' && <span className="chip good">{r.pos.length} PO</span>}
                      </span>
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}
      {intake && <IntakeModal onClose={() => setIntake(false)} onCreated={(id) => { setIntake(false); onOpen(id) }} />}
    </div>
  )
}
