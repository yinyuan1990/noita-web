// 材质混淆表:24 块存档真值 vs 我们生成的同一 chunk,逐像素比"材质 id → 名",输出每块一致率 + 最常见的错配(我们=X / 真值=Y)
// 用法:node scripts/_noita-map-confusion.mjs [top]
import { chromium } from 'playwright'
const TOP = +(process.argv[2] || 18)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
await page.goto('http://localhost:5177/noita-map.html?worker=0')
await page.waitForFunction(() => window.__nm && document.getElementById('mTruth'), null, { timeout: 60000, polling: 300 })
await page.click('#mTruth') // 真值只在切到对照模式时才加载
await page.waitForFunction(() => window.__nm.truth.ready, null, { timeout: 120000, polling: 300 })
await page.waitForTimeout(1000)
const r = await page.evaluate(async (TOP) => {
  const { world, truth, assets } = window.__nm
  const mats = assets.materials, CH = 512
  const tname = (id) => mats.name(id) // 真值已映射成本地材质 id
  const out = { chunks: [], confusion: {} }
  const conf = new Map()
  const bump = (k) => conf.set(k, (conf.get(k) || 0) + 1)
  for (const c of [...truth.chunks.values()].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    await world.prepareChunk(c.cx, c.cy)
    const ours = world.getChunk(c.cx, c.cy)
    if (!ours) { out.chunks.push({ cx: c.cx, cy: c.cy, err: 'no chunk' }); continue }
    let n = 0, same = 0, solidSame = 0, oursSolid = 0, truthSolid = 0
    const local = new Map()
    for (let j = 0; j < CH; j += 2) for (let i = 0; i < CH; i += 2) {
      const a = mats.name(ours.mat[j * CH + i]) || 'air', b = tname(c.mat[j * CH + i]) || 'air'
      n++
      if (a !== 'air') oursSolid++
      if (b !== 'air') truthSolid++
      if ((a !== 'air') === (b !== 'air')) solidSame++
      if (a === b) same++
      else { const k = a + ' → ' + b; bump(k); local.set(k, (local.get(k) || 0) + 1) }
    }
    const top = [...local.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k}=${(v / n * 100).toFixed(1)}%`)
    out.chunks.push({ cx: c.cx, cy: c.cy, biome: ours.biome, solidAgree: +(solidSame / n * 100).toFixed(1), matAgree: +(same / n * 100).toFixed(1), oursSolid: +(oursSolid / n * 100).toFixed(1), truthSolid: +(truthSolid / n * 100).toFixed(1), top })
  }
  const total = [...conf.values()].reduce((a, b) => a + b, 0)
  out.confusion = [...conf.entries()].sort((x, y) => y[1] - x[1]).slice(0, TOP).map(([k, v]) => `${k}: ${(v / total * 100).toFixed(1)}%`)
  return out
}, TOP)
for (const c of r.chunks) console.log(`chunk(${c.cx},${c.cy}) ${c.biome || ''}  实空 ${c.solidAgree}%  材质 ${c.matAgree}%  实心 我们 ${c.oursSolid}% / 真值 ${c.truthSolid}%\n    ${(c.top || [c.err]).join('  ')}`)
console.log('\n全部错配 top:'); for (const l of r.confusion) console.log('  ' + l)
await browser.close()
