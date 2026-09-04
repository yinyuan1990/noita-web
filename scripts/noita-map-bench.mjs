// ── noita-map 性能跑分(桌面模拟手机)──
// 用 Chromium 的 CPU 降频 + 手机视口跑 noita-map.html?bench=…,输出帧/区块统计。
// 经验换算:CPU ×4 ≈ 中端安卓(骁龙 7 系),×6 ≈ 低端/老机;真机数据请直接手机开页面点"跑分"。
// 用法:node scripts/noita-map-bench.mjs [cpu倍率=4] [秒数=20] [worker=1|0|both]
import { chromium } from 'playwright'

const rate = +(process.argv[2] || 4)
const seconds = +(process.argv[3] || 20)
const workerArg = process.argv[4] || 'both'
const modes = workerArg === 'both' ? ['1', '0'] : [workerArg]

const browser = await chromium.launch({ channel: 'msedge', headless: true })
for (const worker of modes) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await page.goto(`http://localhost:5177/noita-map.html?bench=${seconds}&worker=${worker}&workers=1`)
  await page.waitForFunction(() => window.__nm && window.__nm.bench, null, { timeout: (seconds + 90) * 1000, polling: 500 })
  const r = await page.evaluate(() => window.__nm.bench)
  delete r.ua
  console.log(`\n== CPU×${rate}  ${worker === '1' ? 'Worker 生成' : '主线程生成'}  ${seconds}s ==`)
  console.log(`  结论:${r.verdict}`)
  console.log(`  fps ${r.fps}  帧 p50 ${r.frame_p50} / p95 ${r.frame_p95} / max ${r.frame_max} ms  >33ms ${r.long33}  >100ms ${r.long100}  黑洞帧 ${r.hole_pct}%`)
  console.log(`  区块 ${r.chunks} 个  到达 p50 ${r.chunk_wait_p50} / p95 ${r.chunk_wait_p95} ms${r.worker ? `  worker 内 生成 ${r.chunk_gen_p50} / 渲染 ${r.chunk_paint_p50} ms` : ''}`)
  console.log(`  进群系首块(加载页成本)${r.first_chunk_ms} ms  长帧出现时刻(s):${r.long_frames_at_s.join(' ') || '无'}`)
  if (r.heapMB) console.log(`  JS 堆 ${r.heapMB} MB`)
  await ctx.close()
}
await browser.close()
