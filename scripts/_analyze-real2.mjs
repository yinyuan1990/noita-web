// 临时:逐行扫描定位 stbhw 模板网格(找分隔行/列)
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
  const px = (x, y) => { const i = (y * img.width + x) * 4; return (d[i] << 16 | d[i + 1] << 8 | d[i + 2]).toString(16).padStart(6, '0') }
  // 全白行 = 水平分隔;全白列(在某 y 范围内)= 垂直分隔
  const whiteRows = []
  for (let y = 0; y < img.height; y++) {
    let allw = true
    for (let x = 0; x < img.width; x++) if (px(x, y) !== 'ffffff') { allw = false; break }
    if (allw) whiteRows.push(y)
  }
  // c0ffee 像素位置(stbhw 模板标记)
  const cofs = []
  for (let y = 0; y < img.height && cofs.length < 30; y++) for (let x = 0; x < img.width; x++) {
    if (px(x, y) === 'c0ffee') { cofs.push([x, y]); if (cofs.length >= 30) break }
  }
  // 采样几行看结构
  const rows = {}
  for (const y of [1, 2, 3, 9, 17, 97, 98, 99, 100, 105]) {
    let s = ''
    for (let x = 0; x < Math.min(img.width, 96); x++) s += px(x, y) + ','
    rows[y] = s
  }
  return { whiteRows: whiteRows.join(' '), cofs: JSON.stringify(cofs), rows }
}, dataUrl)
console.log('all-white rows:', r.whiteRows)
console.log('first c0ffee px:', r.cofs)
for (const [y, s] of Object.entries(r.rows)) console.log(`y=${y}:`, s.slice(0, 900))
await browser.close()
