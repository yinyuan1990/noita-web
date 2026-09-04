// 把 coalmine.png 局部放大 6x 输出,肉眼确认网格与材质
import { chromium } from 'playwright'
import fs from 'fs'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const dataUrl = 'data:image/png;base64,' + fs.readFileSync('noita-ref/coalmine.png').toString('base64')
const outs = await page.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res) => { img.onload = res; img.src = src })
  const zoom = (x0, y0, w, h, z) => {
    const cv = document.createElement('canvas')
    cv.width = w * z; cv.height = h * z
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, x0, y0, w, h, 0, 0, w * z, h * z)
    return cv.toDataURL('image/png')
  }
  return {
    topleft: zoom(0, 0, 130, 70, 6),    // H 区左上角(含 2 块砖+边框)
    vtop: zoom(0, 186, 70, 130, 6),     // V 区左上角
  }
}, dataUrl)
fs.writeFileSync('scripts/out/cm-topleft.png', Buffer.from(outs.topleft.split(',')[1], 'base64'))
fs.writeFileSync('scripts/out/cm-vtop.png', Buffer.from(outs.vtop.split(',')[1], 'base64'))
console.log('done')
await browser.close()
