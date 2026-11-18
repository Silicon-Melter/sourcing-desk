// Sample data for the offline demo. All companies, people and prices are invented.
import type { AppState, Part, Supplier } from './types'

export function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Item master: standard price (ราคากลาง) per part number, THB per unit. */
export const ITEM_MASTER: Record<string, { standardPrice: number; category: string }> = {
  'BRG-6204ZZ': { standardPrice: 38, category: 'bearing' },
  'BLT-M8X25-88': { standardPrice: 2.1, category: 'fastener' },
  'SHT-SPCC-1.2': { standardPrice: 1450, category: 'steel' },
  'ORG-NBR-40X3': { standardPrice: 4.5, category: 'rubber' },
  'PWD-RAL9005': { standardPrice: 165, category: 'paint' },
  'CBL-VCT-3X1.5': { standardPrice: 32, category: 'electrical' }
}

export function samplePartRows(): string[][] {
  const need = addDays(today(), 14)
  return [
    ['รหัสชิ้นส่วน', 'รายการ', 'สเปค', 'จำนวน', 'หน่วย', 'วันที่ต้องการ'],
    ['BRG-6204ZZ', 'ตลับลูกปืน 6204ZZ', 'Deep groove, 20x47x14 mm, metal shield', '500', 'pcs', need],
    ['BLT-M8X25-88', 'สกรูหัวหกเหลี่ยม M8x25', 'Grade 8.8, zinc plated', '5000', 'pcs', need],
    ['SHT-SPCC-1.2', 'แผ่นเหล็ก SPCC 1.2 มม.', '1219 x 2438 mm, cold rolled', '40', 'sheet', need],
    ['ORG-NBR-40X3', 'โอริง NBR 40x3', 'NBR 70 Shore A', '2000', 'pcs', need],
    ['PWD-RAL9005', 'สีฝุ่นดำ RAL9005', 'Epoxy-polyester, semi-gloss', '200', 'kg', need],
    ['CBL-VCT-3X1.5', 'สายไฟ VCT 3x1.5', '300/500 V, TIS 11', '300', 'm', need]
  ]
}

const p = (priceFactor: number, leadDays: number, moq: number, paymentDays: number, replyHours: number) => ({
  priceFactor,
  leadDays,
  moq,
  paymentDays,
  replyHours
})

export function sampleSuppliers(): Supplier[] {
  return [
    {
      id: 'sup-rattana', name: 'Rattana Bearing & Parts Co., Ltd.', contact: 'คุณสมชาย', email: 'sales@rattana-bearing.example',
      phone: '02-555-0101', province: 'Bangkok', categories: ['bearing', 'rubber'], known: true, verified: true,
      lastPrices: { 'BRG-6204ZZ': 37.5, 'ORG-NBR-40X3': 4.4 }, notes: 'Supplier since 2021. Audited 2025.', profile: p(1.0, 5, 100, 30, 2), source: 'company'
    },
    {
      id: 'sup-bangna', name: 'Bangna Fastener Co., Ltd.', contact: 'คุณวิภา', email: 'quote@bangna-fastener.example',
      phone: '02-555-0144', province: 'Samut Prakan', categories: ['fastener'], known: true, verified: true,
      lastPrices: { 'BLT-M8X25-88': 2.05 }, notes: 'Reliable, slow to reply.', profile: p(0.98, 7, 1000, 60, 6), source: 'company'
    },
    {
      id: 'sup-samut', name: 'Samut Steel Service Center', contact: 'คุณประเสริฐ', email: 'sales@samutsteel.example',
      phone: '034-555-210', province: 'Samut Sakhon', categories: ['steel'], known: true, verified: true,
      lastPrices: { 'SHT-SPCC-1.2': 1480 }, notes: 'Main steel supplier. Prices follow the steel index.', profile: p(1.24, 5, 10, 30, 3), source: 'company'
    },
    {
      id: 'sup-eastern', name: 'Eastern Coating Supply', contact: 'Ms. Nok', email: 'nok@easterncoating.example',
      phone: '038-555-332', province: 'Chonburi', categories: ['paint'], known: true, verified: true,
      lastPrices: { 'PWD-RAL9005': 168 }, notes: '', profile: p(1.02, 6, 50, 45, 2), source: 'company'
    },
    {
      id: 'sup-prapa', name: 'Prapa Electric Wire', contact: 'คุณประภา', email: 'prapa@prapawire.example',
      phone: '02-555-0777', province: 'Nonthaburi', categories: ['electrical'], known: true, verified: true,
      lastPrices: { 'CBL-VCT-3X1.5': 31 }, notes: '', profile: p(0.99, 3, 100, 30, 1), source: 'company'
    },
    {
      id: 'sup-thonburi', name: 'Thonburi Industrial Mart', contact: 'Sales team', email: 'rfq@thonburimart.example',
      phone: '02-555-0900', province: 'Bangkok', categories: ['bearing', 'fastener', 'rubber', 'electrical'], known: false, verified: false,
      lastPrices: {}, notes: 'Found by search. Online catalogue, broad range.', profile: p(0.93, 10, 200, 30, 4), source: 'search'
    },
    {
      id: 'sup-rayong', name: 'Rayong Bolt & Nut', contact: 'คุณอนันต์', email: 'anan@rayongbolt.example',
      phone: '038-555-118', province: 'Rayong', categories: ['fastener'], known: false, verified: false,
      lastPrices: {}, notes: 'Found by search. Near Eastern Seaboard estates.', profile: p(0.9, 12, 5000, 30, 5), source: 'search'
    },
    {
      id: 'sup-nakhon', name: 'Nakhon Steel Trading', contact: 'คุณธนา', email: 'thana@nakhonsteel.example',
      phone: '044-555-640', province: 'Nakhon Ratchasima', categories: ['steel'], known: false, verified: false,
      lastPrices: {}, notes: 'Found by search. Cheaper, ships from the northeast.', profile: p(1.05, 21, 20, 30, 4), source: 'search'
    },
    {
      id: 'sup-chonseal', name: 'Chonburi Seal Tech', contact: 'Mr. Krit', email: 'krit@chonseal.example',
      phone: '038-555-455', province: 'Chonburi', categories: ['rubber'], known: false, verified: false,
      lastPrices: {}, notes: 'Found by search. Makes O-rings in house.', profile: p(0.86, 9, 1000, 30, 3), source: 'search'
    },
    {
      id: 'sup-ayutthaya', name: 'Ayutthaya Powder Paint', contact: 'คุณมาลี', email: 'malee@ayutpowder.example',
      phone: '035-555-290', province: 'Ayutthaya', categories: ['paint'], known: false, verified: false,
      lastPrices: {}, notes: 'Found by search.', profile: p(0.95, 8, 100, 30, 999), source: 'search'
    },
    {
      id: 'sup-pathum', name: 'Pathum Cable Center', contact: 'Sales', email: 'sales@pathumcable.example',
      phone: '02-555-0388', province: 'Pathum Thani', categories: ['electrical'], known: false, verified: false,
      lastPrices: {}, notes: 'Found by search.', profile: p(0.97, 4, 500, 15, 2), source: 'search'
    },
    {
      id: 'sup-spot', name: 'Sukhumvit Spot Parts', contact: 'Hotline', email: 'order@sukhumvitspot.example',
      phone: '02-555-0011', province: 'Bangkok', categories: ['bearing', 'fastener', 'rubber', 'electrical', 'steel', 'paint'], known: false, verified: false,
      lastPrices: {}, notes: 'Spot market: stock on hand, ships next day, expensive.', profile: p(1.35, 1, 1, 0, 1), source: 'search'
    }
  ]
}

export function sampleParts(): Part[] {
  const rows = samplePartRows().slice(1)
  return rows.map((r, i) => ({
    id: `part-${i + 1}`,
    partNo: r[0],
    name: r[1],
    spec: r[2],
    qty: Number(r[3]),
    unit: r[4],
    needBy: r[5],
    standardPrice: ITEM_MASTER[r[0]]?.standardPrice,
    category: ITEM_MASTER[r[0]]?.category
  }))
}

export function initialState(): AppState {
  return {
    settings: {
      lang: 'th',
      role: 'buyer',
      companyName: 'Siam Precision Parts (sample)',
      buyerName: 'Buyer',
      headName: 'Purchasing head',
      apiBaseUrl: '',
      apiKey: '',
      model: '',
      bandLowPct: 10,
      bandHighPct: 20,
      replySpeed: 'fast'
    },
    requests: [],
    suppliers: sampleSuppliers(),
    mailbox: [],
    notifications: [],
    seq: { request: 0, po: 0 }
  }
}
