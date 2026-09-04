// 解析 Noita wang tileset(stbhw 模板):尺寸/布局/颜色直方图
import { chromium } from 'playwright'
import fs from 'fs'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const png = fs.readFileSync('noita-ref/inside.png')
const dataUrl = 'data:image/png;base64,' + png.toString('base64')
const info = await page.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const px = (x, y) => {
    const i = (y * img.width + x) * 4
    return [d[i], d[i + 1], d[i + 2], d[i + 3]]
  }
  // 颜色直方图
  const hist = {}
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const [r, g, b, a] = px(x, y)
    const k = a < 128 ? 'transparent' : `${r},${g},${b}`
    hist[k] = (hist[k] || 0) + 1
  }
  // 第一行像素(stbhw metadata 在右上 3px)
  const meta = []
  for (let x = img.width - 3; x < img.width; x++) meta.push(px(x, 0))
  // 分隔线检测:第 0 行的颜色序列变化(找网格框色)
  const row0 = []
  for (let x = 0; x < Math.min(60, img.width); x++) row0.push(px(x, 0).join(','))
  return { w: img.width, h: img.height, hist, meta, row0: row0.slice(0, 50) }
}, dataUrl)
console.log('尺寸:', info.w, 'x', info.h)
console.log('右上3px(stbhw metadata):', JSON.stringify(info.meta))
const sorted = Object.entries(info.hist).sort((a, b) => b[1] - a[1])
console.log('颜色直方图(前 14):')
for (const [c, n] of sorted.slice(0, 14)) console.log(' ', c, n)
await browser.close()
