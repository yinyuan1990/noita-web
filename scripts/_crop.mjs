// 临时:裁切并放大 PNG 局部(用完删)  用法: node _crop.mjs in.png out.png x y w h scale
import { chromium } from 'playwright'
import fs from 'fs'
const [file, out, x, y, w, h, s = '4'] = process.argv.slice(2)
const b64 = fs.readFileSync(file).toString('base64')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = await page.evaluate(async ([b64, x, y, w, h, s]) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
  const c = document.createElement('canvas'); c.width = w * s; c.height = h * s
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(img, x, y, w, h, 0, 0, w * s, h * s)
  return c.toDataURL()
}, [b64, +x, +y, +w, +h, +s])
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
await browser.close()
