// 看手机上传的操作日志:node scripts/noita-logs.mjs            → 最近会话列表
//                    node scripts/noita-logs.mjs <会话文件>   → 摘要 + 卡住/上报/报错事件(含周围材质图)
//                    node scripts/noita-logs.mjs <会话文件> all → 全部事件
const BASE = 'https://update.cocoaihj.com/updatesoft/noita-log/'
const f = process.argv[2]
if (!f) {
  const list = await (await fetch(BASE + 'list')).json()
  for (const it of list) console.log(`${new Date(it.mtime * 1000).toLocaleString()}  ${String(it.size).padStart(7)} B  ${it.f}`)
  process.exit(0)
}
const txt = await (await fetch(BASE + 'get?f=' + encodeURIComponent(f))).text()
const batches = txt.trim().split('\n').map((l) => JSON.parse(l))
const events = batches.flatMap((b) => b.events.map((e) => ({ ...e, ip: b.ip })))
const open = events.find((e) => e.e === 'open')
console.log(`会话 ${f}  批次 ${batches.length}  事件 ${events.length}  ip ${batches[0]?.ip}`)
if (open) console.log(`设备 ${open.ua}\n屏幕 ${open.w}×${open.h}@${open.dpr} 触屏 ${open.touch} 核 ${open.cores} seed ${open.seed}`)
const count = {}
for (const e of events) count[e.e] = (count[e.e] || 0) + 1
console.log('事件统计', JSON.stringify(count))
const pos = events.filter((e) => e.e === 'pos')
if (pos.length) {
  const fps = pos.map((p) => p.fps).filter(Boolean)
  const phys = pos.map((p) => p.phys).filter((v) => v !== undefined)
  console.log(`帧率 min ${Math.min(...fps)} avg ${(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(0)}  模拟 avg ${(pos.reduce((a, p) => a + (p.sim || 0), 0) / pos.length).toFixed(1)}ms${phys.length ? `  物理 avg ${(phys.reduce((a, b) => a + b, 0) / phys.length).toFixed(1)} max ${Math.max(...phys)}ms` : ''}  轨迹 (${pos[0].x},${pos[0].y}) → (${pos[pos.length - 1].x},${pos[pos.length - 1].y})`)
}
const show = process.argv[3] === 'all' ? events : events.filter((e) => ['stuck', 'report', 'error', 'open'].includes(e.e))
for (const e of show) {
  const { i, t, e: type, box, ...rest } = e
  console.log(`\n[${(t / 1000).toFixed(1)}s] ${type} ${JSON.stringify(rest)}`)
  if (box) {
    // 中心那格用 @ 标出(玩家位置)
    const cy = (box.length - 1) / 2, cx = (box[0].length - 1) / 2
    box.forEach((row, y) => console.log('   ' + (y === cy ? row.slice(0, cx) + '@' + row.slice(cx + 1) : row)))
  }
}
