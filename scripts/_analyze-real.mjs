// 临时:分析原版无损 coalmine.png 的尺寸/色表/网格布局
import { chromium } from 'playwright'
import fs from 'fs'

const SRC = process.argv[2] || 'C:/Users/admin/AppData/LocalLow/Nolla_Games_Noita/data/wang_tiles/coalmine.png'
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
  const cnt = {}
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i] << 16 | d[i + 1] << 8 | d[i + 2]).toString(16).padStart(6, '0') + '/' + d[i + 3]
    cnt[k] = (cnt[k] || 0) + 1
  }
  // 第 0 行与第 0 列的颜色序列(stbhw 模板有边界约束标记行/列)
  const row0 = [], col0 = []
  for (let x = 0; x < Math.min(img.width, 130); x++) { const i = x * 4; row0.push((d[i] << 16 | d[i + 1] << 8 | d[i + 2]).toString(16).padStart(6, '0')) }
  for (let y = 0; y < Math.min(img.height, 130); y++) { const i = y * img.width * 4; col0.push((d[i] << 16 | d[i + 1] << 8 | d[i + 2]).toString(16).padStart(6, '0')) }
  return { w: img.width, h: img.height, colors: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 40), nColors: Object.keys(cnt).length, row0: row0.join(','), col0: col0.join(',') }
}, dataUrl)
console.log('size:', r.w, 'x', r.h, ' unique colors:', r.nColors)
for (const [c, n] of r.colors) console.log(c, n)
console.log('row0:', r.row0)
console.log('col0:', r.col0)
await browser.close()
