// 临时:把 biome_map.png(70×48)按 _biomes_all.xml 色表打印成字符网格(用完删)
import { chromium } from 'playwright'
import fs from 'fs'
const png = fs.readFileSync('noita-ref/unpacked/biome_impl/biome_map.png').toString('base64')
const xml = fs.readFileSync('noita-ref/unpacked/biome/_biomes_all.xml', 'utf8')
const legend = {}
for (const m of xml.matchAll(/biome_filename="data\/(?:biome|biome_impl\/static_tile)\/([\w/]+)\.xml"\s+height_index="(\d+)"\s+color="ff([0-9a-fA-F]{6})"/g)) legend[m[3].toLowerCase()] = { name: m[1], h: +m[2] }
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const px = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
  return { w: img.width, h: img.height, d: Array.from(ctx.getImageData(0, 0, img.width, img.height).data) }
}, png)
await browser.close()
const codes = {}, order = []
const codeOf = (hex) => {
  if (!codes[hex]) { const ch = order.length < 26 ? String.fromCharCode(97 + order.length) : order.length < 52 ? String.fromCharCode(65 + order.length - 26) : String.fromCharCode(48 + ((order.length - 52) % 10)); codes[hex] = ch; order.push(hex) }
  return codes[hex]
}
const rows = []
for (let y = 0; y < px.h; y++) {
  let s = ''
  for (let x = 0; x < px.w; x++) {
    const i = (y * px.w + x) * 4
    const hex = [px.d[i], px.d[i + 1], px.d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    s += codeOf(hex)
  }
  rows.push(String(y).padStart(2) + ' ' + s)
}
console.log('    ' + Array.from({ length: px.w }, (_, i) => (i % 10)).join(''))
console.log(rows.join('\n'))
console.log('--- legend (code hex name height_index) ---')
for (const hex of order) { const L = legend[hex]; console.log(codes[hex], hex, L ? L.name : '?', L ? L.h : '?') }
