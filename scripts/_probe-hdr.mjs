// 临时:只解码 stbhw 头字节
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
  const rgbRow = []
  for (let x = 0; x < img.width; x++) { const i = x * 4; rgbRow.push(d[i], d[i + 1], d[i + 2]) }
  const header = []
  for (let i = 0; i < 9; i++) header.push(rgbRow[img.width * 3 - 1 - i] ^ (i * 55))
  // 尾行也试试(有的版本写在最后一行)
  const rgbLast = []
  for (let x = 0; x < img.width; x++) { const i = ((img.height - 1) * img.width + x) * 4; rgbLast.push(d[i], d[i + 1], d[i + 2]) }
  const header2 = []
  for (let i = 0; i < 9; i++) header2.push(rgbLast[img.width * 3 - 1 - i] ^ (i * 55))
  return { w: img.width, h: img.height, header, header2 }
}, dataUrl)
console.log(JSON.stringify(r))
await browser.close()
