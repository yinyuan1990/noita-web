// 临时探针:验证"挖洞 → 飞远被 LRU 卸载 → 落盘 → 飞回来 → 存档命中,洞还在"
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
await page.goto('http://localhost:5177/noita-map.html?worker=1&workers=1')
await page.waitForFunction(() => window.__nm && window.__nm.streamer, null, { timeout: 60000, polling: 300 })
await page.evaluate(() => window.__nm.store.clear(window.__nm.world.seed))

const waitReady = (cx, cy) => page.waitForFunction(([x, y]) => !!window.__nm.streamer.get(x, y), [cx, cy], { timeout: 60000, polling: 100 })
const at = (x, y) => page.evaluate(([x, y]) => { const c = window.__nm.cam; c.x = x; c.y = y; c.z = 1 }, [x, y])

await at(400, 700); await waitReady(35, 15)
// 挖:世界 (400,700) 附近半径 14 变空气
const before = await page.evaluate(async () => {
  const s = window.__nm.streamer
  const e = s.get(35, 15)
  // 找一个实心像素来挖(chunk 35,15 = 世界 x 0..512, y 512..1024)
  let idx = -1
  for (let i = 100 * 512 + 100; i < 512 * 512; i += 7) if (e.mat[i] !== 0) { idx = i; break }
  const lx = idx % 512, ly = Math.floor(idx / 512)
  const was = e.mat[idx]
  await s.paintCircle(lx, 512 + ly, 14, 0)
  window.__probeIdx = idx
  return { idx, name: window.__nm.assets.materials.name(was), now: e.mat[idx], dirty: e.dirty }
})
console.log('挖前材质', before.name, '→ 挖后', before.now, 'dirty', before.dirty, 'idx', before.idx)

// 飞远,让 LRU 超过 cache 上限(48 块):走一圈大远路
for (const [x, y] of [[3000, 700], [6000, 700], [9000, 700], [12000, 700], [15000, 700], [18000, 700], [21000, 700], [24000, 700], [27000, 700], [30000, 700]]) {
  await at(x, y); await page.waitForTimeout(700)
}
const mid = await page.evaluate(() => ({ resident: window.__nm.streamer.entries.size, has: !!window.__nm.streamer.entries.get('35,15'), ...window.__nm.streamer.stats }))
console.log('飞远后 常驻', mid.resident, '原区块还在内存?', mid.has, '已落盘', mid.persisted, '已卸载', mid.evicted)
await page.waitForTimeout(500)
const cnt = await page.evaluate(() => window.__nm.store.count(window.__nm.world.seed))
console.log('IndexedDB 里本种子区块数', cnt)

// 飞回来
await at(400, 700); await waitReady(35, 15)
const after = await page.evaluate(() => {
  const s = window.__nm.streamer
  const e = s.get(35, 15)
  return { now: e.mat[window.__probeIdx], fromStore: e.fromStore, stats: s.stats }
})
console.log('回来后该点材质', after.now, '(0=空气,洞还在)', '来自存档', after.fromStore, '存档命中总数', after.stats.fromStore)
console.log(after.now === 0 && after.fromStore ? 'PASS 落盘回读成功' : 'FAIL')
await browser.close()
