import { useRef, useState } from 'react'
import type { Bi, Part } from '@shared/types'
import { partsFromRows, partsFromText } from '@shared/logic'
import { addDays, samplePartRows, today } from '@shared/sample'
import { t } from '../i18n'
import { createRequest, useApp } from '../store'
import { readRows, sampleBomWorkbook, saveFile } from '../files'

export function IntakeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const s = useApp()
  const lang = s.settings.lang
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [parts, setParts] = useState<Part[]>([])
  const [warnings, setWarnings] = useState<Bi[]>([])
  const [fileName, setFileName] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const needBy = addDays(today(), 14)

  async function takeFile(f: File) {
    setFileName(f.name)
    try {
      const rows = await readRows(f)
      const r = partsFromRows(rows, needBy)
      setParts(r.parts)
      setWarnings(r.warnings)
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
    } catch {
      setWarnings([{ th: 'อ่านไฟล์ไม่ได้ ลองบันทึกเป็น .xlsx หรือ .csv', en: 'Could not read the file. Save it as .xlsx or .csv and try again.' }])
    }
  }

  function takeText(v: string) {
    setText(v)
    const r = partsFromText(v, needBy)
    setParts(r.parts)
    setWarnings(v.trim() ? r.warnings : [])
  }

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="intake-h" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2 id="intake-h">{t(lang, 'intakeTitle')}</h2>
        <div className="form" style={{ maxWidth: 'none' }}>
          <label>
            {t(lang, 'intakeName')}
            <input id="intake-name" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={lang === 'th' ? 'เช่น วัตถุดิบล็อต ม.ค.' : 'e.g. January lot materials'} />
          </label>
          <div
            className={`drop${over ? ' over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files[0]
              if (f) takeFile(f)
            }}
          >
            {fileName || t(lang, 'intakeFile')}
            <input id="intake-file" ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && takeFile(e.target.files[0])} />
          </div>
          <button
            className="btn ghost sm"
            style={{ justifySelf: 'start' }}
            onClick={() => saveFile('sample-bom.xlsx', sampleBomWorkbook(samplePartRows()))}
          >
            {lang === 'th' ? 'ดาวน์โหลดไฟล์ BOM ตัวอย่าง' : 'Download a sample BOM file'}
          </button>
          <label>
            {t(lang, 'intakePaste')}
            <textarea id="intake-text" rows={5} value={text} onChange={(e) => takeText(e.target.value)} placeholder={'BRG-6204ZZ, ตลับลูกปืน 6204ZZ, 500, pcs\nBLT-M8X25-88, สกรู M8x25, 5000, pcs'} />
          </label>
        </div>
        {parts.length > 0 && (
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>{t(lang, 'partNo')}</th>
                  <th>{t(lang, 'item')}</th>
                  <th className="num">{t(lang, 'qty')}</th>
                  <th>{t(lang, 'unit')}</th>
                  <th className="num">{t(lang, 'stdPrice')}</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.partNo}</td>
                    <td>{p.name}</td>
                    <td className="num">{p.qty.toLocaleString()}</td>
                    <td>{p.unit}</td>
                    <td className="num">{p.standardPrice ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {warnings.length > 0 && (
          <div>
            <strong className="small">{t(lang, 'warnings')}</strong>
            <ul className="warnlist">
              {warnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w[lang]}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {t(lang, 'cancel')}
          </button>
          <button
            className="btn primary"
            disabled={parts.length === 0}
            onClick={() => onCreated(createRequest(title.trim() || (lang === 'th' ? 'ใบขอซื้อใหม่' : 'New request'), parts))}
          >
            {t(lang, 'intakeCreate')} ({parts.length})
          </button>
        </div>
      </div>
    </div>
  )
}
