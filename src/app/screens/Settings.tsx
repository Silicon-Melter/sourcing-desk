import { useState } from 'react'
import type { Settings as S } from '@shared/types'
import { t } from '../i18n'
import { resetAll, update, useApp } from '../store'
import type { AiStatus } from '../agent'

export function Settings({ ai, toast }: { ai: AiStatus; toast: (m: string) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const [confirm, setConfirm] = useState(false)
  const set = <K extends keyof S>(k: K, v: S[K]) => update((d) => void (d.settings[k] = v))

  return (
    <div className="page">
      <div className="head">
        <h1>{t(lang, 'navSettings')}</h1>
        <span className="sub">{t(lang, 'savedLocally')}</span>
      </div>
      <div className="form">
        <label>
          {t(lang, 'settingsCompany')}
          <input id="set-company" type="text" value={s.settings.companyName} onChange={(e) => set('companyName', e.target.value)} />
        </label>
        <label>
          {t(lang, 'settingsBuyer')}
          <input id="set-buyer" type="text" value={s.settings.buyerName} onChange={(e) => set('buyerName', e.target.value)} />
        </label>
        <label>
          {t(lang, 'settingsBand')}
          <span className="pair">
            −<input id="set-low" type="number" min={0} max={50} value={s.settings.bandLowPct} onChange={(e) => set('bandLowPct', Number(e.target.value))} />%
            <span className="muted">/</span>
            +<input id="set-high" type="number" min={0} max={100} value={s.settings.bandHighPct} onChange={(e) => set('bandHighPct', Number(e.target.value))} />%
          </span>
          <span className="help">{t(lang, 'settingsBandHelp')}</span>
        </label>
        <label>
          {t(lang, 'settingsSpeed')}
          <select id="set-speed" value={s.settings.replySpeed} onChange={(e) => set('replySpeed', e.target.value as S['replySpeed'])}>
            <option value="instant">{t(lang, 'speedInstant')}</option>
            <option value="fast">{t(lang, 'speedFast')}</option>
            <option value="realistic">{t(lang, 'speedRealistic')}</option>
          </select>
        </label>
        <div>
          <strong className="small">AI</strong>
          <div className="ai" style={{ marginTop: 4 }}>
            <span className={`dot ${ai}`} />
            {t(lang, ai === 'on' ? 'aiOn' : ai === 'off' ? 'aiOff' : 'aiChecking')}
          </div>
          <div className="help small muted">{t(lang, 'aiHelp')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!confirm ? (
            <button className="btn danger" onClick={() => setConfirm(true)}>
              {t(lang, 'resetDemo')}
            </button>
          ) : (
            <>
              <button
                className="btn danger"
                onClick={() => {
                  resetAll()
                  setConfirm(false)
                  toast(lang === 'th' ? 'ล้างข้อมูลแล้ว' : 'All data cleared')
                }}
              >
                {t(lang, 'resetConfirm')}
              </button>
              <button className="btn" onClick={() => setConfirm(false)}>
                {t(lang, 'cancel')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
