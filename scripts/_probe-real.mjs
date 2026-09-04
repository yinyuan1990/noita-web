// 临时:按 stbhw corner 模板精确解析原版 coalmine.png(s=13, nc=[1,2,1,2], vary 3x3)
import { chromium } from 'playwright'
import fs from 'fs'

const SRC = 'C:/Users/admin/AppData/LocalLow/Nolla_Games_Noita/data/wang_tiles/coalmine.png'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64')

const r = await page.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res) => { img.onload = res; img.src = src })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const px = (x, y) => { const i = (y * img.width + x) * 4; return (d[i] << 16 | d[i + 1] << 8 | d[i + 2]) >>> 0 }
  const s = 13, ncs = [1, 2, 1, 2], vx = 3, vy = 3
  // corner 模式布局(stbhw__process_template corner 分支)
  const cells = []
  let ypos = 2
  for (let k = 0; k < ncs[2]; k++) for (let j = 0; j < ncs[1]; j++) for (let i = 0; i < ncs[0]; i++) for (let q = 0; q < vy; q++) {
    // process_h_row: a in nc1, b in nc2, c in nc3(内层顺序 a 最快), d=i e=j f=k, variants=vx
    let xpos = 0
    for (let v = 0; v < vx; v++) for (let c = 0; c < ncs[3]; c++) for (let b = 0; b < ncs[2]; b++) for (let a = 0; a < ncs[1]; a++) {
      cells.push({ x: xpos + 1, y: ypos + 1, w: 2 * s, h: s, kind: 'h', a, b, c, d: i, e: j, f: k })
      xpos += 2 * s + 3
    }
    ypos += s + 3
  }
  ypos += 2
  for (let k = 0; k < ncs[3]; k++) for (let j = 0; j < ncs[0]; j++) for (let i = 0; i < ncs[1]; i++) for (let q = 0; q < vx; q++) {
    let xpos = 0
    for (let v = 0; v < vy; v++) for (let c = 0; c < ncs[2]; c++) for (let b = 0; b < ncs[3]; b++) for (let a = 0; a < ncs[0]; a++) {
      cells.push({ x: xpos + 1, y: ypos + 1, w: s, h: 2 * s, kind: 'v', a, b, c, d: i, e: j, f: k })
      xpos += s + 3
    }
    ypos += 2 * s + 3
  }
  const cnt = {}
  const cofTiles = []
  for (const c of cells) {
    let n = 0, minY = 99, maxY = -1, minX = 99, maxX = -1
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const k2 = px(c.x + x, c.y + y).toString(16).padStart(6, '0')
      cnt[k2] = (cnt[k2] || 0) + 1
      if (k2 === 'c0ffee') { n++; minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x) }
    }
    if (n) cofTiles.push({ kind: c.kind, n, rows: [minY, maxY], cols: [minX, maxX] })
  }
  return { total: cells.length, endY: ypos, cof: cofTiles, colors: Object.entries(cnt).sort((a, b) => b[1] - a[1]) }
}, dataUrl)
console.log('cells:', r.total, 'template endY:', r.endY, '(应=448)')
console.log('c0ffee tiles:', r.cof.length, '/', r.total)
for (const t of r.cof) console.log(' ', t.kind, 'n=' + t.n, 'rows', t.rows, 'cols', t.cols)
console.log('content colors (all):')
for (const [c, n] of r.colors) console.log(' ', c, n)
await browser.close()
