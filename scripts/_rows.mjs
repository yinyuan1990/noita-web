// 临时:逐行打印 PNG 里某颜色的 x 区间(用完删)
import { chromium } from 'playwright'
import fs from 'fs'
const [file, want, step = '4'] = process.argv.slice(2)
const b64 = fs.readFileSync(file).toString('base64')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const r = await page.evaluate(async ([b64, want, step]) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const out = []
  for (let y = 0; y < img.height; y += +step) {
    const segs = []; let s = -1
    for (let x = 0; x <= img.width; x++) {
      const i = (y * img.width + x) * 4
      const hex = x < img.width ? (d[i + 3] < 128 ? 'transparent' : [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')) : ''
      const hit = hex === want
      if (hit && s < 0) s = x
      if (!hit && s >= 0) { segs.push(`${s}-${x - 1}`); s = -1 }
    }
    out.push(`${String(y).padStart(3)}: ${segs.join(' ')}`)
  }
  return out
}, [b64, want, step])
console.log(r.join('\n'))
await browser.close()
