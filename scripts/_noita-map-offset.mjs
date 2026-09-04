// 临时:在 ±30 px 内搜索 wang 层 → 世界坐标的最佳偏移(真值 实/空 一致率最高),并输出白块/灰块的真值材质分布
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:5177/noita-map.html')
await page.waitForFunction(() => window.__nm && window.__nm.truth.ready && window.__nm.world.layers.size > 0, null, { timeout: 60000, polling: 300 })
await page.waitForTimeout(1500)
const r = await page.evaluate(() => {
  const { world, truth, wangAt, assets } = window.__nm
  const layer = [...world.layers.values()].find((l) => l.biome === 'coalmine')
  const CH = 512
  const mats = assets.materials
  // 只用煤矿区域内的真值 chunk
  const tchunks = [...truth.chunks.values()].filter((c) => world.regionKeyOf(c.cx, c.cy) === [...world.layers.keys()][0])
  const evalOff = (dx, dy, step) => {
    let ok = 0, n = 0
    for (const c of tchunks) {
      for (let j = 40; j < CH - 40; j += step) for (let i = 40; i < CH - 40; i += step) {
        const ax = c.cx * CH + i, ay = c.cy * CH + j
        const w = wangAt(layer, Math.floor((ax + dx - layer.originX) / 10), Math.floor((ay + dy - layer.originY) / 10))
        if (w !== 0 && w !== 0xffffff) continue
        n++
        const solid = c.mat[j * CH + i] !== 0
        if ((w === 0xffffff) === solid) ok++
      }
    }
    return ok / n
  }
  let best = { dx: 0, dy: 0, r: 0 }
  for (let dy = -30; dy <= 30; dy += 2) for (let dx = -30; dx <= 30; dx += 2) { const v = evalOff(dx, dy, 6); if (v > best.r) best = { dx, dy, r: v } }
  let fine = best
  for (let dy = best.dy - 3; dy <= best.dy + 3; dy++) for (let dx = best.dx - 3; dx <= best.dx + 3; dx++) { const v = evalOff(dx, dy, 3); if (v > fine.r) fine = { dx, dy, r: v } }
  // 白块真值材质分布(用最佳偏移)
  const hist = new Map(), greyHist = new Map()
  for (const c of tchunks) for (let j = 0; j < CH; j += 2) for (let i = 0; i < CH; i += 2) {
    const ax = c.cx * CH + i, ay = c.cy * CH + j
    const w = wangAt(layer, Math.floor((ax + fine.dx - layer.originX) / 10), Math.floor((ay + fine.dy - layer.originY) / 10))
    const m = mats.name(c.mat[j * CH + i])
    if (w === 0xffffff) hist.set(m, (hist.get(m) || 0) + 1)
    else if (w > 0 && ((w >> 16) & 255) === ((w >> 8) & 255) && ((w >> 8) & 255) === (w & 255)) { const k = (w & 255) + ':' + m; greyHist.set(k, (greyHist.get(k) || 0) + 1) }
  }
  const top = (h, n = 10) => [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}=${v}`).join(' ')
  return { origin: [layer.originX, layer.originY], base: evalOff(0, 0, 3), best, fine, tchunks: tchunks.length, white: top(hist), grey: top(greyHist, 16) }
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
