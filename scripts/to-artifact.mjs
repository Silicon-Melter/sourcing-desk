// Fold Vite's build into one artifact page. The artifact host adds <!doctype>, <html>,
// <head> and <body>, so the page is: title, metas, font links, inline CSS, root, inline JS.
import { readFileSync, readdirSync, writeFileSync } from 'fs'
const html = readFileSync('dist/index.html', 'utf8')
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
const keep = []
const title = head.match(/<title>[\s\S]*?<\/title>/)
if (title) keep.push(title[0])
for (const m of head.matchAll(/<meta name="claude:[^>]*>/g)) keep.push(m[0])
for (const m of head.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts[^>]*>/g)) keep.push(m[0])
const assets = readdirSync('dist/assets')
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n')
const js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n')
const out = [
  ...keep,
  `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`,
  '<div id="root"></div>',
  `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`
].join('\n')
writeFileSync('dist/sourcing-desk.html', out)
console.log('artifact page: dist/sourcing-desk.html', (out.length / 1024).toFixed(0) + ' KB')
