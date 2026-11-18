// Spreadsheet in (BOM / MRP export) and out (PO in the company's layout).
import * as XLSX from 'xlsx'
import type { AppState, PurchaseOrder, PurchaseRequest } from '@shared/types'

export async function readRows(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<(string | number | Date)[]>(ws, { header: 1, raw: true, defval: '' })
  return rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c))))
}

export function poWorkbook(po: PurchaseOrder, req: PurchaseRequest, s: AppState): Uint8Array {
  const sup = s.suppliers.find((x) => x.id === po.supplierId)!
  const aoa: (string | number)[][] = [
    [s.settings.companyName],
    ['ใบสั่งซื้อ / PURCHASE ORDER'],
    [],
    ['เลขที่ PO / PO No.', po.number, '', 'วันที่ / Date', po.createdAt.slice(0, 10)],
    ['ผู้ขาย / Supplier', sup.name, '', 'อ้างอิง / Ref.', req.id],
    ['ผู้ติดต่อ / Contact', `${sup.contact}  ${sup.phone}`, '', 'อีเมล / Email', sup.email],
    [],
    ['ลำดับ / No.', 'รหัส / Part no.', 'รายการ / Description', 'จำนวน / Qty', 'หน่วย / Unit', 'ราคาต่อหน่วย / Unit price (THB)', 'จำนวนเงิน / Amount (THB)', 'กำหนดส่ง / Delivery']
  ]
  po.lines.forEach((l, i) => {
    const p = req.parts.find((x) => x.id === l.partId)!
    aoa.push([i + 1, p.partNo, `${p.name}${p.spec ? ' – ' + p.spec : ''}`, l.qty, p.unit, l.unitPrice, Math.round(l.qty * l.unitPrice * 100) / 100, p.needBy])
  })
  const vat = Math.round(po.total * 0.07 * 100) / 100
  aoa.push([], ['', '', '', '', '', 'รวม / Subtotal', po.total], ['', '', '', '', '', 'VAT 7%', vat], ['', '', '', '', '', 'รวมทั้งสิ้น / Total', Math.round((po.total + vat) * 100) / 100])
  aoa.push([], ['ผู้จัดทำ / Prepared by', s.settings.buyerName, '', 'ผู้อนุมัติ / Approved by', req.approval === 'head_approved' ? s.settings.headName : s.settings.buyerName])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 44 }, { wch: 10 }, { wch: 8 }, { wch: 22 }, { wch: 20 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, po.number)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

export function sampleBomWorkbook(rows: string[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'BOM')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

interface Downloads {
  save(r: { filename: string; data: Uint8Array | Blob }): Promise<unknown>
}

/** Offer a file through the artifact `downloads` capability; falls back to a blob link outside claude.ai. */
export async function saveFile(filename: string, data: Uint8Array): Promise<'saved' | 'declined' | 'unavailable'> {
  const dl = (await window.claude?.use('downloads').catch(() => null)) as Downloads | null
  if (dl) {
    try {
      await dl.save({ filename, data })
      return 'saved'
    } catch (e) {
      return (e as { code?: string })?.code === 'declined' ? 'declined' : 'unavailable'
    }
  }
  if (!window.claude) {
    const url = URL.createObjectURL(new Blob([data as BlobPart]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    return 'saved'
  }
  return 'unavailable'
}
