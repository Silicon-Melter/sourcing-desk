import { useState } from 'react'
import { fmtDate, fmtTime, t } from '../i18n'
import { useApp } from '../store'

export function Mailbox({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const mails = s.mailbox.filter((m) => m.delivered).sort((a, b) => b.at.localeCompare(a.at))
  const coming = s.mailbox.filter((m) => !m.delivered).length
  const [sel, setSel] = useState<string | null>(null)
  const cur = mails.find((m) => m.id === sel) ?? mails[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="page" style={{ paddingBottom: 12 }}>
        <div className="head">
          <h1>{t(lang, 'navMailbox')}</h1>
          {coming > 0 && (
            <span className="chip accent">
              {coming} {t(lang, 'inTransit')}
            </span>
          )}
          <span className="sub">{t(lang, 'mailboxNote')}</span>
        </div>
      </div>
      {mails.length === 0 ? (
        <div className="page">
          <div className="panel empty">{t(lang, 'noMail')}</div>
        </div>
      ) : (
        <div className="mail">
          <div className="list">
            {mails.map((m) => {
              const sp = s.suppliers.find((x) => x.id === m.supplierId)
              return (
                <button key={m.id} className="item" aria-current={cur?.id === m.id} onClick={() => setSel(m.id)}>
                  <span className="top">
                    <span className={`chip ${m.direction === 'in' ? 'good' : ''}`}>{m.direction === 'in' ? t(lang, 'received') : t(lang, 'sent')}</span>
                    <span>{fmtTime(lang, m.at)}</span>
                  </span>
                  <strong>{sp?.name}</strong>
                  <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.subject}
                  </span>
                </button>
              )
            })}
          </div>
          {cur && (
            <div className="read">
              <div className="head" style={{ marginBottom: 12 }}>
                <h1 style={{ fontSize: 16 }}>{cur.subject}</h1>
                <span className="grow" />
                <button className="btn sm" onClick={() => onOpen(cur.requestId)}>
                  {cur.requestId}
                </button>
              </div>
              <div className="small muted mono" style={{ marginBottom: 12 }}>
                {cur.direction === 'in' ? `${lang === 'th' ? 'จาก' : 'From'}: ` : `${t(lang, 'to')}: `}
                {s.suppliers.find((x) => x.id === cur.supplierId)?.email} · {fmtDate(lang, cur.at)} {fmtTime(lang, cur.at)}
              </div>
              <pre>{cur.body}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
