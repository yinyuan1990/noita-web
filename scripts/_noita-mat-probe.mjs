// 临时探针:打印世界坐标附近 r 半径内的材质直方图(看某块颜色是什么材质)
// 用法:node scripts/_noita-mat-probe.mjs x,y [r]
import { chromium } from 'playwright'
const [wx, wy] = (process.argv[2] || '0,0').split(',').map(Number)
const r = +(process.argv[3] || 12)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
await page.goto('http://localhost:5177/noita-map.html')
await page.waitForFunction(() => document.getElementById('hud')?.textContent.includes('seed'), null, { timeout: 20000 })
const res = await page.evaluate(async ([wx, wy, r]) => {
  const w = window.__nm.world
  const h = new Map()
  for (let y = wy - r; y <= wy + r; y++) for (let x = wx - r; x <= wx + r; x++) {
    const cx = Math.floor(x / 512) + 35, cy = Math.floor(y / 512) + 14
    await w.prepareChunk(cx, cy)
    const ch = w.getChunk(cx, cy)
    const m = ch.mat[(((y % 512) + 512) % 512) * 512 + (((x % 512) + 512) % 512)]
    h.set(m, (h.get(m) || 0) + 1)
  }
  return [...h.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${w.mats.name(k)}(${k}):${v}`)
}, [wx, wy, r])
console.log(res.join(' '))
await browser.close()
