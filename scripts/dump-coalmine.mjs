// 验证真 coalmine.png 网格偏移:dump H0/H1/V0 字符画(s=28 假设:H 步进 59/31,V 步进 31/59)
import { chromium } from 'playwright'
import fs from 'fs'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + fs.readFileSync('noita-ref/coalmine.png').toString('base64')
const out = await page.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res) => { img.onload = res; img.src = src })
  const cv = document.createElement('canvas')
  cv.width = img.width; cv.height = img.height
  const ctx = cv.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, img.width, img.height).data
  const ch = (x, y) => {
    const i = (y * img.width + x) * 4
    const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]]
    if (a < 128) return ' '
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (mx - mn > 60) return '?' // 高饱和=标记/特殊材质
    if (mx > 200) return '#'     // 白系=主材质
    if (mx > 140) return '='     // 浅灰
    if (mx > 70) return '-'      // 中灰
    if (mx > 24) return '+'      // 深灰(煤?)
    return '.'                    // 黑=空气
  }
  const cut = (x0, y0, w, h) => {
    const rows = []
    for (let y = 0; y < h; y++) {
      let s = ''
      for (let x = 0; x < w; x++) s += ch(x0 + x, y0 + y)
      rows.push(s)
    }
    return rows.join('\n')
  }
  return {
    h0: cut(1, 3, 56, 28),
    v0: cut(1, 190, 28, 56),
  }
}, dataUrl)
console.log('── H0 @(1,3) 56×28 ──')
console.log(out.h0)
console.log('── V0 @(1,190) 28×56 ──')
console.log(out.v0)
await browser.close()
