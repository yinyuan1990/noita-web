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
  const lod = pos.map((p) => p.lod).filter((v) => v !== undefined), lodLow = lod.filter((v) => v > 1).length
  const avg = (k) => (pos.reduce((a, p) => a + (p[k] || 0), 0) / pos.length).toFixed(1)
  // 渲染分项 r = [世界位图+叠层, 弹丸/特效, 植被+实体+玩家, 光照合成, 乘光+天空, 折射/放大贴屏](老包只有 5 项:最后一项 = 乘光+天空+折射合在一起):取掉帧最厉害那几秒(fps 最低的 5 条)的平均,看渲染慢在哪
  const withR = pos.filter((p) => Array.isArray(p.r))
  if (withR.length) {
    const worst = [...withR].sort((a, b) => a.fps - b.fps).slice(0, 5)
    const rs = worst[0].r.map((_, k) => (worst.reduce((a, p) => a + (p.r[k] || 0), 0) / worst.length).toFixed(1))
    const tail = rs.length >= 6 ? `乘光/天空 ${rs[4]} 折射/贴屏 ${rs[5]}` : `合成 ${rs[4]}`
    console.log(`最卡的 ${worst.length} 秒(fps ${worst.map((p) => p.fps).join('/')}):渲染分项 世界 ${rs[0]} 特效 ${rs[1]} 实体 ${rs[2]} 光照 ${rs[3]} ${tail} ms · 碎屑 ${worst.map((p) => p.debris ?? '-').join('/')} 火花 ${worst.map((p) => p.sparks ?? '-').join('/')} sfx ${worst.map((p) => p.sfx ?? '-').join('/')} 精灵 ${worst.map((p) => p.pdc ?? '-').join('/')} bmp ${worst.map((p) => p.bmp ?? '-').join('/')} rp ${worst.map((p) => p.rp ?? '-').join('/')}`)
    // rs = 每秒 1 帧自动 GPU 同步计时的分项(每项结束 getImageData 逼 GPU 干完):这才是每段真实的账;r 里不同步时全记在最后贴屏那项
    const withRs = worst.filter((p) => Array.isArray(p.rs))
    if (withRs.length) { const ss = withRs[0].rs.map((_, k) => (withRs.reduce((a, p) => a + (p.rs[k] || 0), 0) / withRs.length).toFixed(1)); console.log(`  同步计时分项(真实归属):世界 ${ss[0]} 特效 ${ss[1]} 实体 ${ss[2]} 光照 ${ss[3]} 乘光/天空 ${ss[4]} 折射/贴屏 ${ss[5]} ms`) }
    // slow = 那一秒最慢一帧 ms,long = > 50ms 的帧数:fps 是 0.5s 平均,单帧 200ms 的卡顿在 fps 里看不出来
    const withL = worst.filter((p) => Array.isArray(p.l))
    if (withL.length) { const ls = withL[0].l.map((_, k) => (withL.reduce((a, p) => a + (p.l[k] || 0), 0) / withL.length).toFixed(1)); console.log(`  逻辑分项:弹丸 ${ls[0]} 实体 ${ls[1]} 物理 ${ls[2]} 植被/火花/碎屑 ${ls[3]} ms`) }
    // cap = 系统限帧(iOS 低电量 / 过热把 rAF 压到 30Hz):活干完了还在等下一帧
    const caps = pos.filter((p) => p.cap).length
    if (caps) console.log(`  系统限 30Hz 的秒数 ${caps}/${pos.length}(低电量模式 / 机身过热,WebKit 把 requestAnimationFrame 压到 30)`)
    const withSlow = pos.filter((p) => p.slow !== undefined)
    if (withSlow.length) { const ws = [...withSlow].sort((a, b) => b.slow - a.slow).slice(0, 5); console.log(`  最慢单帧(ms/长帧数@时刻): ${ws.map((p) => `${p.slow}/${p.long ?? '-'}@${(p.t / 1000).toFixed(0)}s`).join(' ')} · > 100ms 的秒数 ${withSlow.filter((p) => p.slow > 100).length}/${withSlow.length}`) }
  }
  console.log(`帧率 min ${Math.min(...fps)} avg ${(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(0)}  模拟 avg ${avg('sim')}ms${lod.length ? `(降档 ${lodLow}/${lod.length} 秒,最深 1/${Math.max(...lod)})` : ''} 逻辑 avg ${avg('logic')} 渲染 avg ${avg('render')}${phys.length ? `  物理 avg ${(phys.reduce((a, b) => a + b, 0) / phys.length).toFixed(1)} max ${Math.max(...phys)}ms` : ''}  轨迹 (${pos[0].x},${pos[0].y}) → (${pos[pos.length - 1].x},${pos[pos.length - 1].y})`)
}
const show = process.argv[3] === 'all' ? events : events.filter((e) => ['stuck', 'report', 'error', 'open'].includes(e.e))
let shotN = 0
for (const e of show) {
  const { i, t, e: type, box, shot, ...rest } = e
  if (shot) { // report 带的画面截图(view 画布 jpeg)→ 存到 %TEMP%/noita-shot-N.jpg
    const { writeFileSync } = await import('node:fs')
    const p = `${process.env.TEMP || '/tmp'}/noita-shot-${++shotN}.jpg`
    writeFileSync(p, Buffer.from(shot.split(',')[1], 'base64'))
    rest.shotFile = p
  }
  console.log(`\n[${(t / 1000).toFixed(1)}s] ${type} ${JSON.stringify(rest)}`)
  if (box) {
    // 中心那格用 @ 标出(玩家位置)
    const cy = (box.length - 1) / 2, cx = (box[0].length - 1) / 2
    box.forEach((row, y) => console.log('   ' + (y === cy ? row.slice(0, cx) + '@' + row.slice(cx + 1) : row)))
  }
}
