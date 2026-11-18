import { t } from '../i18n'
import { useApp } from '../store'

export function Suppliers() {
  const s = useApp()
  const lang = s.settings.lang
  const sorted = [...s.suppliers].sort((a, b) => Number(b.known) - Number(a.known) || a.name.localeCompare(b.name))
  return (
    <div className="page">
      <div className="head">
        <h1>{t(lang, 'navSuppliers')}</h1>
        <span className="chip warn">{t(lang, 'sampleBadge')}</span>
        <span className="sub">
          {lang === 'th'
            ? 'รายชื่อที่ผู้ช่วยสะสมไว้: ผู้ขายเดิมของบริษัท และรายใหม่ที่หาเจอ (ต้องตรวจโรงงานก่อนสั่งครั้งแรก)'
            : 'What the agent knows: the company’s suppliers plus new ones it found (audit before the first order).'}
        </span>
      </div>
      <div className="tablewrap">
        <table className="grid">
          <thead>
            <tr>
              <th>{t(lang, 'supplier')}</th>
              <th>{t(lang, 'categories')}</th>
              <th>{t(lang, 'province')}</th>
              <th>{lang === 'th' ? 'ติดต่อ' : 'Contact'}</th>
              <th>{lang === 'th' ? 'สถานะ' : 'Status'}</th>
              <th className="num">{lang === 'th' ? 'ส่งของปกติ' : 'Usual lead'}</th>
              <th className="num">{t(lang, 'payment')}</th>
              <th>{lang === 'th' ? 'ราคาล่าสุด' : 'Last prices'}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((sp) => (
              <tr key={sp.id}>
                <td>
                  <strong>{sp.name}</strong>
                  {sp.notes && <div className="small muted">{sp.notes}</div>}
                </td>
                <td className="small">{sp.categories.join(', ')}</td>
                <td>{sp.province}</td>
                <td className="small">
                  {sp.contact}
                  <div className="mono muted">{sp.email}</div>
                  <div className="mono muted">{sp.phone}</div>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <span className={`chip ${sp.known ? '' : 'accent'}`}>{sp.known ? t(lang, 'company') : t(lang, 'fromSearch')}</span>
                    <span className={`chip ${sp.verified ? 'good' : 'warn'}`}>{sp.verified ? t(lang, 'verified') : t(lang, 'notVerified')}</span>
                  </div>
                </td>
                <td className="num">
                  {sp.profile.leadDays} {t(lang, 'days')}
                </td>
                <td className="num">{sp.profile.paymentDays === 0 ? (lang === 'th' ? 'เงินสด' : 'cash') : `${sp.profile.paymentDays} ${t(lang, 'days')}`}</td>
                <td className="small mono">
                  {Object.entries(sp.lastPrices).map(([k, v]) => (
                    <div key={k}>
                      {k}: {v}
                    </div>
                  ))}
                  {Object.keys(sp.lastPrices).length === 0 && '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
