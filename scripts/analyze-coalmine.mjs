// 解析真 coalmine.png:stbhw 元数据 + 颜色直方图
import { chromium } from 'playwright'
import fs from 'fs'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + fs.readFileSync('noita-ref/coalmine.png').toString('base64')
const info = await page.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res) => { img.onload = res; img.src = src })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  // stbhw 头解码:第一行 RGB 字节流尾部 9 字节 XOR i*55
  const w = img.width
  const header = []
  for (let i = 0; i < 9; i++) {
    const byteIdx = w * 3 - 1 - i
    const px = (byteIdx / 3) | 0, ch = byteIdx % 3
    const v = d[(px * 4) + ch]
    header.push((v ^ (i * 55)) & 0xff)
  }
  const hist = {}
  for (let y = 0; y < img.height; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const k = d[i + 3] < 128 ? 'alpha0' : ((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]).toString(16).padStart(6, '0')
    hist[k] = (hist[k] || 0) + 1
  }
  return { w: img.width, h: img.height, header, hist }
}, dataUrl)
console.log('尺寸:', info.w, 'x', info.h)
console.log('header[0..8]:', info.header.join(','))
const isCorner = info.header[7] === 0xc0
console.log(isCorner
  ? `corner 模式 num_color=[${info.header.slice(0, 4)}] vary=${info.header[4]}x${info.header[5]} short_side=${info.header[6]}`
  : `edge 模式 num_color=[${info.header.slice(0, 6)}] vary=${info.header[6]}x${info.header[7]} short_side=${info.header[8]}`)
const sorted = Object.entries(info.hist).sort((a, b) => b[1] - a[1])
console.log('颜色直方图(≥80px 的色):')
for (const [c, n] of sorted) if (n >= 80) console.log(`  #${c}  ${n}`)
await browser.close()
