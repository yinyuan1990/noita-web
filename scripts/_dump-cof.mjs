// 临时:把含 c0ffee 的砖放大 12x 导出 PNG,c0ffee 高亮为纯红边框标注
import { chromium } from 'playwright'
import fs from 'fs'

const SRC = 'C:/Users/admin/AppData/LocalLow/Nolla_Games_Noita/data/wang_tiles/coalmine.png'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64')

const shots = await page.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res) => { img.onload = res; img.src = src })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const px = (x, y) => { const i = (y * img.width + x) * 4; return (d[i] << 16 | d[i + 1] << 8 | d[i + 2]) >>> 0 }
  const s = 13, ncs = [1, 2, 1, 2], vx = 3, vy = 3
  const cells = []
  let ypos = 2
  for (let k = 0; k < ncs[2]; k++) for (let j = 0; j < ncs[1]; j++) for (let i = 0; i < ncs[0]; i++) for (let q = 0; q < vy; q++) {
    let xpos = 0
    for (let v = 0; v < vx; v++) for (let c = 0; c < ncs[3]; c++) for (let b = 0; b < ncs[2]; b++) for (let a = 0; a < ncs[1]; a++) { cells.push({ x: xpos + 1, y: ypos + 1, w: 2 * s, h: s }); xpos += 2 * s + 3 }
    ypos += s + 3
  }
  ypos += 2
  for (let k = 0; k < ncs[3]; k++) for (let j = 0; j < ncs[0]; j++) for (let i = 0; i < ncs[1]; i++) for (let q = 0; q < vx; q++) {
    let xpos = 0
    for (let v = 0; v < vy; v++) for (let c = 0; c < ncs[2]; c++) for (let b = 0; b < ncs[3]; b++) for (let a = 0; a < ncs[0]; a++) { cells.push({ x: xpos + 1, y: ypos + 1, w: s, h: 2 * s }); xpos += s + 3 }
    ypos += 2 * s + 3
  }
  const out = []
  const Z = 14
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci]
    let has = false
    for (let y = 0; y < c.h && !has; y++) for (let x = 0; x < c.w && !has; x++) if (px(c.x + x, c.y + y) === 0xc0ffee) has = true
    if (!has) continue
    const oc = document.createElement('canvas')
    oc.width = c.w * Z; oc.height = c.h * Z
    const octx = oc.getContext('2d')
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const v = px(c.x + x, c.y + y)
      octx.fillStyle = '#' + v.toString(16).padStart(6, '0')
      octx.fillRect(x * Z, y * Z, Z, Z)
      if (v === 0xc0ffee) { octx.strokeStyle = '#ff0000'; octx.lineWidth = 2; octx.strokeRect(x * Z + 1, y * Z + 1, Z - 2, Z - 2) }
    }
    out.push({ idx: ci, png: oc.toDataURL() })
    if (out.length >= 6) break
  }
  return out
}, dataUrl)
fs.mkdirSync('scripts/out', { recursive: true })
for (const s2 of shots) {
  fs.writeFileSync(`scripts/out/cof-tile-${s2.idx}.png`, Buffer.from(s2.png.split(',')[1], 'base64'))
  console.log('wrote cof-tile-' + s2.idx + '.png')
}
await browser.close()
