/**
 * 像素巫师 · 瓦片导入器(长期工具,勿删)
 *
 * 把任意图片(手绘/AI 生成)灌进地图瓦片集:
 *   node scripts/import-tile.mjs <图片路径> <槽位0-9>
 *
 * 流程:缩放到 48×40(最近邻)→ 每像素量化到调色板最近色(见 docs/pixel-guide.md §3)
 *      → 自动校验 16~27 行通行带(不通的列在 20~23 行强制凿开)→ 写回 tileset.png
 * 注意:槽位 3 是竖井(需 16~31 列垂直贯通),导入会警告。
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TILESET = path.join(__dirname, '..', 'public', 'res', 'pixel-tiles', 'tileset.png')
const [imgPath, slotArg] = process.argv.slice(2)
const slot = Number(slotArg)
if (!imgPath || !fs.existsSync(imgPath) || !(slot >= 0 && slot <= 9)) {
  console.error('用法: node scripts/import-tile.mjs <图片路径> <槽位0-9>')
  process.exit(1)
}
if (slot === 3) console.warn('警告:槽位3是竖井瓦片,请确保图片有 16~31 列的垂直通道')

const mime = imgPath.endsWith('.jpg') || imgPath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
const srcUrl = `data:${mime};base64,${fs.readFileSync(imgPath).toString('base64')}`
const setUrl = `data:image/png;base64,${fs.readFileSync(TILESET).toString('base64')}`

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
const out = await page.evaluate(async ({ srcUrl, setUrl, slot }) => {
  const TW = 48, TH = 40
  // 调色板(与 pixelDemo.js PNG_MAT 一致);white=保留墙 black=空气
  const PAL = [
    [0xff, 0xff, 0xff], [0x00, 0x00, 0x00], [0x3a, 0x6f, 0xd8], [0x6b, 0x5a, 0x20],
    [0xff, 0x5a, 0x10], [0xc9, 0xa8, 0x6a], [0x34, 0x34, 0x3a], [0xff, 0xd0, 0x54],
    [0x7a, 0x52, 0x30], [0x94, 0xca, 0xe8], [0x58, 0x8c, 0x30], [0x70, 0x50, 0x34],
    [0xff, 0x00, 0xff],
  ]
  const PASSABLE = new Set([1, 2, 3, 4, 12]) // 空气/水/油/熔岩/火把 = 可通行
  const load = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u })
  const src = await load(srcUrl)
  const set = await load(setUrl)
  // 缩到 48×40(最近邻:先画到小画布,平滑关闭)
  const sc = document.createElement('canvas')
  sc.width = TW
  sc.height = TH
  const sg = sc.getContext('2d')
  sg.imageSmoothingEnabled = false
  sg.drawImage(src, 0, 0, TW, TH)
  const d = sg.getImageData(0, 0, TW, TH)
  const q = new Uint8Array(TW * TH) // 调色板索引
  const counts = {}
  for (let i = 0; i < TW * TH; i++) {
    const o = i * 4
    if (d.data[o + 3] < 128) { q[i] = 0; continue } // 透明 = 保留墙
    let best = 0, bd = Infinity
    for (let p = 0; p < PAL.length; p++) {
      const dr = d.data[o] - PAL[p][0], dg = d.data[o + 1] - PAL[p][1], db = d.data[o + 2] - PAL[p][2]
      const dist = dr * dr + dg * dg + db * db
      if (dist < bd) { bd = dist; best = p }
    }
    q[i] = best
    counts[best] = (counts[best] || 0) + 1
  }
  // 通行带校验:16~27 行每列至少 1 格可通行,否则 20~23 行凿开
  let fixed = 0
  for (let x = 0; x < TW; x++) {
    let ok = false
    for (let y = 16; y <= 27; y++) if (PASSABLE.has(q[y * TW + x])) { ok = true; break }
    if (!ok) {
      for (let y = 20; y <= 23; y++) q[y * TW + x] = 1
      fixed++
    }
  }
  // 写回图集
  const cv = document.createElement('canvas')
  cv.width = set.width
  cv.height = set.height
  const g = cv.getContext('2d')
  g.drawImage(set, 0, 0)
  const img2 = g.getImageData(slot * TW, 0, TW, TH)
  for (let i = 0; i < TW * TH; i++) {
    const p = PAL[q[i]]
    img2.data[i * 4] = p[0]
    img2.data[i * 4 + 1] = p[1]
    img2.data[i * 4 + 2] = p[2]
    img2.data[i * 4 + 3] = 255
  }
  g.putImageData(img2, slot * TW, 0)
  return { dataUrl: cv.toDataURL('image/png'), counts, fixed }
}, { srcUrl, setUrl, slot })

fs.writeFileSync(TILESET, Buffer.from(out.dataUrl.split(',')[1], 'base64'))
console.log(`已写入槽位 ${slot} → ${TILESET}`)
console.log('量化统计(调色板索引:像素数):', JSON.stringify(out.counts))
console.log(`通行带修复列数: ${out.fixed}`)
await browser.close()
