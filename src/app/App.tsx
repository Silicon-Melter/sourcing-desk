import { useEffect, useState } from 'react'
import type { Lang } from '@shared/types'
import { t } from './i18n'
import { tick, update, useApp } from './store'
import { getSample, type AiStatus } from './agent'
import { Board } from './screens/Board'
import { Workspace } from './screens/Workspace'
import { Approvals } from './screens/Approvals'
import { Suppliers } from './screens/Suppliers'
import { Mailbox } from './screens/Mailbox'
import { Settings } from './screens/Settings'
import { Icon } from './components/Icon'

export type Screen = 'requests' | 'approvals' | 'suppliers' | 'mailbox' | 'settings'

export function App() {
  const s = useApp()
  const lang = s.settings.lang
  const [screen, setScreen] = useState<Screen>('requests')
  const [openReq, setOpenReq] = useState<string | null>(null)
  const [ai, setAi] = useState<AiStatus>('checking')
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    let live = true
    getSample().then((x) => live && setAi(x ? 'on' : 'off'))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [toast])

  const waiting = s.requests.filter((r) => r.approval === 'awaiting_head').length
  const nav: { id: Screen; icon: Parameters<typeof Icon>[0]['name']; label: string; badge?: number }[] = [
    { id: 'requests', icon: 'board', label: t(lang, 'navRequests') },
    { id: 'approvals', icon: 'check', label: t(lang, 'navApprovals'), badge: waiting },
    { id: 'suppliers', icon: 'factory', label: t(lang, 'navSuppliers') },
    { id: 'mailbox', icon: 'mail', label: t(lang, 'navMailbox') },
    { id: 'settings', icon: 'gear', label: t(lang, 'navSettings') }
  ]
  const go = (id: Screen) => {
    setScreen(id)
    if (id !== 'requests') setOpenReq(null)
  }
  const openRequest = (id: string) => {
    setScreen('requests')
    setOpenReq(id)
  }

  return (
    <div className="desk">
      <div className="window">
        <div className="titlebar">
          <div className="logo" aria-hidden="true">SD</div>
          <span className="name">{t(lang, 'appName')}</span>
          <span className="co">· {s.settings.companyName}</span>
          <span className="spacer" />
          <div className="winctl" aria-hidden="true">
            <span>—</span>
            <span>▢</span>
            <span>✕</span>
          </div>
        </div>
        <div className="body">
          <nav className="side" aria-label="Main">
            {nav.map((n) => (
              <button key={n.id} className="nav" aria-current={screen === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {n.badge ? <span className="badge">{n.badge}</span> : null}
              </button>
            ))}
            <div className="foot">
              <span className="small muted">{t(lang, 'viewAs')}</span>
              <div className="seg" role="group" aria-label={t(lang, 'viewAs')}>
                {(['buyer', 'head'] as const).map((r) => (
                  <button key={r} aria-pressed={s.settings.role === r} onClick={() => update((d) => void (d.settings.role = r))}>
                    {t(lang, r === 'buyer' ? 'roleBuyer' : 'roleHead')}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label={t(lang, 'settingsLang')}>
                {(['th', 'en'] as Lang[]).map((l) => (
                  <button key={l} aria-pressed={lang === l} onClick={() => update((d) => void (d.settings.lang = l))}>
                    {l === 'th' ? 'ไทย' : 'English'}
                  </button>
                ))}
              </div>
              <div className="ai" title={t(lang, 'aiHelp')}>
                <span className={`dot ${ai}`} />
                {t(lang, ai === 'on' ? 'aiOn' : ai === 'off' ? 'aiOff' : 'aiChecking')}
              </div>
            </div>
          </nav>
          <main className="main">
            {screen === 'requests' && !openReq && <Board onOpen={openRequest} />}
            {screen === 'requests' && openReq && (
              <Workspace reqId={openReq} onBack={() => setOpenReq(null)} onAi={setAi} toast={setToast} />
            )}
            {screen === 'approvals' && <Approvals onOpen={openRequest} />}
            {screen === 'suppliers' && <Suppliers />}
            {screen === 'mailbox' && <Mailbox onOpen={openRequest} />}
            {screen === 'settings' && <Settings ai={ai} toast={setToast} />}
          </main>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
