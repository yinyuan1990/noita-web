// 临时:统计 pixel scene PNG 的颜色占比(用完删)
import { chromium } from 'playwright'
import fs from 'fs'
const files = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
for (const f of files) {
  const b64 = fs.readFileSync(f).toString('base64')
  const r = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, img.width, img.height).data
    const cnt = {}
    for (let i = 0; i < d.length; i += 4) {
      const k = d[i + 3] < 128 ? 'transparent' : [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
      cnt[k] = (cnt[k] || 0) + 1
    }
    return { w: img.width, h: img.height, cnt }
  }, b64)
  const tot = r.w * r.h
  const top = Object.entries(r.cnt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${(v / tot * 100).toFixed(1)}%`)
  console.log(f.split(/[\\/]/).pop(), `${r.w}x${r.h}`, top.join(' '))
}
await browser.close()
