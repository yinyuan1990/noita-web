// ── noita-map 查看器:区块流 + 真值对照(只是 UI,算法全在 src/noita-map)──
import { NoitaAssets, NoitaWorld, ChunkPainter, WorldClient, ChunkStreamer, ChunkStore, coords } from '../noita-map/index.js'
import { wangAt } from '../noita-map/core/wangLayer.js'

const { CHUNK, WORLD_CENTER_CHUNK_X: WCX, WORLD_CENTER_CHUNK_Y: WCY } = coords
const TRUTH_SEED = 1674172626
const $ = (id) => document.getElementById(id)
const stage = $('stage'), view = $('view'), ctx = view.getContext('2d')
const statEl = $('stat'), hoverEl = $('hover'), hud = $('hud')
// URL 参数(自动化跑分用):?worker=0|1&bench=秒数&seed=…&workers=N
const Q = new URLSearchParams(location.search)
// 子路径部署(线上 /updatesoft/noita/)时资源基址跟着 BASE_URL 走;dev 为 '/'
const BASE = import.meta.env.BASE_URL || '/'
const RES = BASE + 'res/noita'

const assets = await new NoitaAssets({ base: RES }).init()
const painter = new ChunkPainter(assets)
const mats = assets.materials

let world = null
let mode = 'gen'
const cam = { x: 400, y: 600, z: 1.2 } // 世界坐标中心 + 缩放
const chunkCanvas = new Map()   // "cx,cy" → canvas|ImageBitmap(生成结果,带 .chunk)
const wangCanvas = new Map()
const truthCanvas = new Map()
const diffCanvas = new Map()
const preparing = new Set()
let dirty = true

// ── Worker 模式:生成+渲染都在 mapWorker 里,主线程只 drawImage ──
let useWorker = Q.get('worker') !== '0'
let client = null
let streamer = null   // Worker 模式下所有区块进出都走它:方向预取 / 帧预算 / LRU / 落盘
let store = null
try { store = await new ChunkStore().open() } catch (e) { console.warn('IndexedDB 不可用,改动不落盘', e) }
const workerCount = +(Q.get('workers') || (navigator.hardwareConcurrency > 4 ? 2 : 1))
async function ensureClient(seed) {
  if (!client) client = await new WorldClient({ base: RES, seed, workers: workerCount, chunkCache: 24 }).init()
  else if (client.seed !== seed) await client.setSeed(seed)
  if (!streamer || streamer.seed !== seed) {
    streamer?.clear()
    // behind=1:掉头瞬间(跑分蛇形折返、玩家回头)背后那格已经在,iPhone 实测黑洞帧 2.9% 主要出在折返点
    streamer = new ChunkStreamer(client, { store, cache: 48, ahead: +($('optAhead').value || 2), behind: 1, side: 1, maxInFlight: 2, maxAcceptPerFrame: 2 })
    streamer.seed = seed
  }
  return client
}
// 切后台 / 关页前把挖过的区块写进去(Noita 也是退出时落盘)
document.addEventListener('visibilitychange', () => { if (document.hidden) streamer?.flush() })
window.addEventListener('pagehide', () => { streamer?.flush() })
// 跑分记录(每个区块:请求→画出 的主线程延迟 + worker 内三段耗时)
const perf = { chunks: [], frames: [] }

// ── 真值(存档 dump)──
const truth = { ready: false, chunks: new Map(), nameToLocal: null }
async function loadTruth() {
  try {
    const seedInfo = await (await fetch('/res/noita-ref/save-truth/seed.json')).json()
    const names = await (await fetch('/res/noita-ref/save-truth/materials.json')).json()
    truth.nameToLocal = names.map((n) => (mats.byName.has(n) ? mats.byName.get(n) : 0))
    await Promise.all(seedInfo.chunks.map(async (c) => {
      const buf = await (await fetch('/res/noita-ref/save-truth/' + c.file)).arrayBuffer()
      const src = new Uint16Array(buf)
      const mat = new Uint16Array(src.length)
      for (let i = 0; i < src.length; i++) mat[i] = truth.nameToLocal[src[i]] ?? 0
      truth.chunks.set((c.wx / CHUNK + WCX) + ',' + (c.wy / CHUNK + WCY), { cx: c.wx / CHUNK + WCX, cy: c.wy / CHUNK + WCY, mat })
    }))
    truth.ready = true
    truth.seed = seedInfo.seed
  } catch (e) { console.warn('真值不可用', e) }
}
// 真值 12MB 只在切到对照模式时才加载(别混进性能测试)
let truthLoading = null
const ensureTruth = () => (truthLoading ||= loadTruth().then(() => { dirty = true }))

function newWorld(seed) {
  world = new NoitaWorld(assets, seed, { chunkCache: 96 })
  window.__nm = { world, assets, truth, cam, wangAt, perf, get client() { return client }, get streamer() { return streamer }, store } // 调试/探针用
  chunkCanvas.clear(); wangCanvas.clear(); diffCanvas.clear(); preparing.clear()
  perf.chunks.length = 0
  if (useWorker) ensureClient(seed).then(() => { dirty = true })
  dirty = true
  updateStat()
}

function mkCanvas() { const c = document.createElement('canvas'); c.width = CHUNK; c.height = CHUNK; return c }

// ── 各层区块画布 ──
async function ensureChunk(cx, cy) {
  const key = cx + ',' + cy
  if (chunkCanvas.has(key) || preparing.has(key)) return
  preparing.add(key)
  const w = world
  const t0 = performance.now()
  try {
    {
      await w.prepareChunk(cx, cy)
      if (w !== world) return
      const chunk = w.getChunk(cx, cy)
      await painter.prepare(chunk)
      if (w !== world) return
      const cv = mkCanvas()
      painter.paint(chunk, cv)
      cv.chunk = chunk
      chunkCanvas.set(key, cv)
      perf.chunks.push({ key, wait: performance.now() - t0 })
    }
    dirty = true
  } catch (e) {
    if (!/seed changed/.test(String(e))) console.error('chunk', key, e)
  } finally { preparing.delete(key) }
}
const workerLayers = new Map()

/** 统一取"已就位的区块画面":Worker 模式走 streamer,否则走主线程缓存。返回 {img, chunk} */
function readyChunk(cx, cy) {
  if (useWorker) {
    const e = streamer?.get(cx, cy)
    if (!e) return null
    if (!e.bitmap) {
      // Worker 里没有 OffscreenCanvas(老 WebView / 无头 WebKit):主线程用材质自己画一次
      if (e.mat && !e.painting) {
        e.painting = true
        const chunk = { cx, cy, biome: e.biome, mat: e.mat, scenes: e.scenes }
        painter.prepare(chunk).then(() => { const cv = mkCanvas(); painter.paint(chunk, cv); e.bitmap = cv; dirty = true })
      }
      return null
    }
    if (!e.view) {
      e.view = { chunk: { cx, cy, biome: e.biome, mat: e.mat, scenes: e.scenes, layer: null } }
      if (e.timing) perf.chunks.push({ key: e.key, wait: e.wait ?? 0, ...e.timing })
      if (e.layerInfo) workerLayers.set(e.layerInfo.biome, e.layerInfo)
    }
    e.view.img = e.bitmap
    return e.view
  }
  const cv = chunkCanvas.get(cx + ',' + cy)
  return cv ? { img: cv, chunk: cv.chunk } : null
}

const WANG_PAL = { 0: 0x0c0c10, 0xffffff: 0x807860, 0xc0ffee: 0x40c0a0 }
function wangChunkCanvas(cx, cy) {
  const key = cx + ',' + cy
  if (wangCanvas.has(key)) return wangCanvas.get(key)
  const cv = readyChunk(cx, cy)
  if (!cv || !cv.chunk.layer) return null // Worker 模式拿不到 layer,退回生成图
  const layer = cv.chunk.layer
  const out = mkCanvas(), c2 = out.getContext('2d'), img = c2.createImageData(CHUNK, CHUNK)
  const ax0 = cx * CHUNK, ay0 = cy * CHUNK
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const c = wangAt(layer, coords.absToWangX(layer, ax0 + i), coords.absToWangY(layer, ay0 + j))
    let col = c < 0 ? 0x202020 : WANG_PAL[c] !== undefined ? WANG_PAL[c] : mats.fromWang(c) >= 0 ? mats.color[mats.fromWang(c)] : c
    const o = (j * CHUNK + i) * 4
    img.data[o] = col >> 16 & 255; img.data[o + 1] = col >> 8 & 255; img.data[o + 2] = col & 255; img.data[o + 3] = 255
  }
  c2.putImageData(img, 0, 0)
  wangCanvas.set(key, out)
  return out
}

function truthChunkCanvas(cx, cy) {
  const key = cx + ',' + cy
  if (truthCanvas.has(key)) return truthCanvas.get(key)
  const t = truth.chunks.get(key)
  if (!t) return null
  const out = mkCanvas(), c2 = out.getContext('2d'), img = c2.createImageData(CHUNK, CHUNK)
  for (let i = 0; i < t.mat.length; i++) {
    const m = t.mat[i]
    const col = m === 0 ? 0x0c0c10 : mats.color[m]
    const o = i * 4
    img.data[o] = col >> 16 & 255; img.data[o + 1] = col >> 8 & 255; img.data[o + 2] = col & 255; img.data[o + 3] = 255
  }
  c2.putImageData(img, 0, 0)
  truthCanvas.set(key, out)
  return out
}

const diffStats = new Map()
function diffChunkCanvas(cx, cy) {
  const key = cx + ',' + cy
  if (diffCanvas.has(key)) return diffCanvas.get(key)
  const t = truth.chunks.get(key), g = readyChunk(cx, cy)
  if (!t || !g || !g.chunk.mat) return null
  const gm = g.chunk.mat
  const out = mkCanvas(), c2 = out.getContext('2d'), img = c2.createImageData(CHUNK, CHUNK)
  let same = 0, n = 0, matSame = 0
  for (let i = 0; i < gm.length; i++) {
    const a = gm[i] !== 0, b = t.mat[i] !== 0
    n++
    let col
    if (a === b) { same++; if (gm[i] === t.mat[i]) matSame++; col = a ? 0x3a4a3a : 0x0c0c10 }
    else col = a ? 0xff3030 : 0x3070ff // 红:我们实/真值空;蓝:我们空/真值实
    const o = i * 4
    img.data[o] = col >> 16 & 255; img.data[o + 1] = col >> 8 & 255; img.data[o + 2] = col & 255; img.data[o + 3] = 255
  }
  c2.putImageData(img, 0, 0)
  diffCanvas.set(key, out)
  diffStats.set(key, { air: same / n, mat: matSame / n })
  return out
}

// ── 绘制 ──
function resize() {
  view.width = stage.clientWidth; view.height = stage.clientHeight
  dirty = true
}
window.addEventListener('resize', resize)
resize()

function worldToScreen(wx, wy) { return [(wx - cam.x) * cam.z + view.width / 2, (wy - cam.y) * cam.z + view.height / 2] }
function screenToWorld(sx, sy) { return [(sx - view.width / 2) / cam.z + cam.x, (sy - view.height / 2) / cam.z + cam.y] }

let lastDrawT = 0
function draw(now = performance.now()) {
  const [wx0, wy0] = screenToWorld(0, 0), [wx1, wy1] = screenToWorld(view.width, view.height)
  // Worker 模式:每帧先让区块流调度(方向预取 / 帧预算 / LRU),有新区块到就标脏
  if (useWorker && streamer) {
    const dt = lastDrawT ? now - lastDrawT : 16
    if (streamer.update({ x0: wx0, y0: wy0, x1: wx1, y1: wy1 }, dt)) dirty = true
    if (streamer.inFlight.size || streamer.done.length) dirty = true
  }
  lastDrawT = now
  if (!dirty || !world) return
  dirty = false
  ctx.fillStyle = '#04050a'
  ctx.fillRect(0, 0, view.width, view.height)
  ctx.imageSmoothingEnabled = false
  const cx0 = Math.floor(wx0 / CHUNK) + WCX, cx1 = Math.floor(wx1 / CHUNK) + WCX
  const cy0 = Math.floor(wy0 / CHUNK) + WCY, cy1 = Math.floor(wy1 / CHUNK) + WCY
  const split = mode === 'split'
  const splitX = view.width / 2
  let nVis = 0, nReady = 0
  const showScenes = $('optScenes').checked
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      nVis++
      const [sx, sy] = worldToScreen((cx - WCX) * CHUNK, (cy - WCY) * CHUNK)
      const sz = CHUNK * cam.z
      const gen = readyChunk(cx, cy)
      if (!gen) { if (!useWorker) ensureChunk(cx, cy); continue }
      nReady++
      const drawLayer = (cv, clipL, clipR) => {
        if (!cv) return
        ctx.save()
        if (clipL !== undefined) { ctx.beginPath(); ctx.rect(clipL, 0, clipR - clipL, view.height); ctx.clip() }
        ctx.drawImage(cv, sx, sy, sz, sz)
        ctx.restore()
      }
      if (mode === 'gen') drawLayer(gen.img)
      else if (mode === 'wang') drawLayer(wangChunkCanvas(cx, cy) || gen.img)
      else if (mode === 'truth') drawLayer(truthChunkCanvas(cx, cy) || null)
      else if (mode === 'diff') drawLayer(diffChunkCanvas(cx, cy) || gen.img)
      else if (split) { drawLayer(gen.img, 0, splitX); drawLayer(truthChunkCanvas(cx, cy), splitX, view.width) }
      if (showScenes && (mode === 'gen' || mode === 'wang' || split)) {
        ctx.strokeStyle = 'rgba(255,90,200,0.8)'; ctx.fillStyle = 'rgba(255,160,230,0.95)'
        ctx.font = `${Math.max(9, 10 * Math.min(1, cam.z))}px sans-serif`
        for (const s of gen.chunk.scenes) {
          if (s.ax < cx * CHUNK || s.ay < cy * CHUNK) continue // 只在左上所在 chunk 画一次
          const [x, y] = worldToScreen(s.x, s.y)
          ctx.strokeRect(x, y, s.w * cam.z, s.h * cam.z)
          ctx.fillText(`${s.name}${s.material ? ' · ' + s.material : ''}`, x + 2, y - 2)
        }
      }
    }
  }
  if (bench.running && !bench.warming && nReady < nVis) bench.holeFrames++ // 用户真正看到"黑洞"的帧
  // 主线程模式的简单预取(视口外一圈);Worker 模式的方向预取在 streamer 里
  if (!useWorker && nReady === nVis && $('optPrefetch').checked) {
    for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
      if (cy >= cy0 && cy <= cy1 && cx >= cx0 && cx <= cx1) continue
      if (!chunkCanvas.has(cx + ',' + cy)) ensureChunk(cx, cy)
    }
  }
  // 挖过的区块标一下(dirty = 会落盘)
  if (useWorker && streamer && $('optGrid').checked) {
    ctx.fillStyle = 'rgba(255,200,60,0.85)'; ctx.font = '10px sans-serif'
    for (const e of streamer.entries.values()) if (e.dirty) { const [sx, sy] = worldToScreen((e.cx - WCX) * CHUNK, (e.cy - WCY) * CHUNK); ctx.fillText('● 已改动,卸载时落盘', sx + 3, sy + 24) }
  }
  if (split) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(splitX - 1, 0, 2, view.height) }
  if ($('optGrid').checked) {
    ctx.strokeStyle = 'rgba(120,160,200,0.35)'; ctx.lineWidth = 1
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(160,190,220,0.7)'
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const [sx, sy] = worldToScreen((cx - WCX) * CHUNK, (cy - WCY) * CHUNK)
      ctx.strokeRect(sx, sy, CHUNK * cam.z, CHUNK * cam.z)
      ctx.fillText(`${cx},${cy} ${world.biomeAtChunk(cx, cy) || '?'}`, sx + 3, sy + 12)
    }
  }
  // 出生点
  const [ox, oy] = worldToScreen(0, 0)
  ctx.strokeStyle = '#7fffd4'; ctx.beginPath(); ctx.moveTo(ox - 8, oy); ctx.lineTo(ox + 8, oy); ctx.moveTo(ox, oy - 8); ctx.lineTo(ox, oy + 8); ctx.stroke()

  let diffTxt = ''
  if (mode === 'diff' || split) {
    let a = 0, m = 0, n = 0
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { const d = diffStats.get(cx + ',' + cy) || (diffChunkCanvas(cx, cy), diffStats.get(cx + ',' + cy)); if (d) { a += d.air; m += d.mat; n++ } }
    if (n) diffTxt = `\n可见真值区块 ${n}:实/空一致 ${(a / n * 100).toFixed(1)}%  材质一致 ${(m / n * 100).toFixed(1)}%`
  }
  const st = useWorker && streamer ? `  在途 ${streamer.inFlight.size} 待收 ${streamer.done.length} 常驻 ${streamer.entries.size}/${streamer.cache}  存档命中 ${streamer.stats.fromStore} 落盘 ${streamer.stats.persisted}  速度 ${Math.hypot(streamer.vel.x, streamer.vel.y) | 0}px/s` : (preparing.size ? '  生成中 ' + preparing.size : '')
  hud.textContent = `seed ${world.seed}  cam (${cam.x | 0}, ${cam.y | 0})  ×${cam.z.toFixed(2)}  区块 ${nReady}/${nVis}${st}${diffTxt}`
  if (preparing.size) dirty = true
}
// ── 帧记录 + 跑分 ──
// 跑分 = 相机沿煤矿自动巡航(不断进入新区块,最坏情况),记录每帧间隔与每个区块的到达延迟。
// 判据(手机上):p95 帧 ≤ 33ms(不掉到 30fps 以下)、>100ms 的长帧 = 0、区块到达 p95 ≤ 500ms。
const bench = { running: false, warming: false, result: null }
let lastFrame = 0
function loop(t) {
  if (bench.running && !bench.warming) {
    if (lastFrame) {
      const dt = t - lastFrame
      perf.frames.push(dt)
      if (dt > 100) bench.longAt.push(+((t - bench.t0) / 1000).toFixed(1))
    }
    lastFrame = t
    const b = bench
    const el = (t - b.t0) / 1000
    if (el >= b.seconds) finishBench()
    else {
      // 蛇形巡航:沿煤矿横向 -700 → 2100 再折回,每趟往下走一层
      const span = 2800, speed = b.speed
      const s = el * speed
      const lap = Math.floor(s / span), u = s - lap * span
      cam.x = -700 + (lap % 2 === 0 ? u : span - u)
      cam.y = b.y0 + lap * 260
      cam.z = b.zoom
      dirty = true
    }
  }
  draw()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

function pct(arr, p) { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))] }
async function startBench(seconds = 20, { speed = 260, zoom = 1.3, y0 = 200 } = {}) {
  if (bench.running) return
  Object.assign(bench, { running: true, warming: true, seconds, speed, zoom, y0, result: null, longAt: [], holeFrames: 0 })
  setMode('gen')
  chunkCanvas.clear(); wangCanvas.clear(); diffCanvas.clear()
  // 预热:进入群系的一次性成本(砖库解码、wang 层生成、布景 PNG 预载)单独计为 first_chunk_ms,
  // 游戏里这段放在加载页;巡航统计的是稳态。
  cam.x = -700; cam.y = y0; cam.z = zoom
  streamer?.clear()
  const t0 = performance.now()
  const c0x = Math.floor(-700 / CHUNK) + WCX, c0y = Math.floor(y0 / CHUNK) + WCY
  if (useWorker) {
    await ensureClient(world.seed)
    dirty = true
    await new Promise((res) => { const tick = () => (readyChunk(c0x, c0y) ? res() : requestAnimationFrame(tick)); tick() })
  } else await ensureChunk(c0x, c0y)
  bench.firstChunkMs = performance.now() - t0
  perf.frames.length = 0; perf.chunks.length = 0
  lastFrame = 0
  bench.t0 = performance.now()
  bench.warming = false
}
function finishBench() {
  bench.running = false
  const f = perf.frames, c = perf.chunks
  const r = {
    worker: useWorker, workers: useWorker ? workerCount : 0, offscreen: !!client?.offscreen,
    seconds: bench.seconds, viewport: [view.width, view.height], dpr: devicePixelRatio,
    first_chunk_ms: +bench.firstChunkMs.toFixed(0), long_frames_at_s: bench.longAt,
    hole_frames: bench.holeFrames, hole_pct: +(bench.holeFrames / Math.max(1, f.length) * 100).toFixed(1),
    prefetch: $('optPrefetch').checked, ahead: useWorker ? streamer?.ahead : 1,
    streamer: useWorker && streamer ? { ...streamer.stats, resident: streamer.entries.size } : null,
    frames: f.length, fps: +(f.length / bench.seconds).toFixed(1),
    frame_p50: +pct(f, 0.5).toFixed(1), frame_p95: +pct(f, 0.95).toFixed(1), frame_max: +Math.max(0, ...f).toFixed(1),
    long33: f.filter((x) => x > 33).length, long100: f.filter((x) => x > 100).length,
    chunks: c.length,
    chunk_wait_p50: +pct(c.map((x) => x.wait), 0.5).toFixed(0), chunk_wait_p95: +pct(c.map((x) => x.wait), 0.95).toFixed(0),
    chunk_gen_p50: useWorker ? +pct(c.map((x) => x.gen), 0.5).toFixed(0) : null,
    chunk_paint_p50: useWorker ? +pct(c.map((x) => x.paint), 0.5).toFixed(0) : null,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
    cores: navigator.hardwareConcurrency, ua: navigator.userAgent,
  }
  // 判据:帧稳(p95≤33、无 100ms 长帧)且几乎看不到黑洞(<3% 的帧有未就位区块)
  r.verdict = r.frame_p95 <= 33 && r.long100 === 0 && r.hole_pct < 3 ? '流畅' : r.frame_p95 <= 50 && r.long100 <= 2 && r.hole_pct < 15 ? '可接受' : '卡'
  bench.result = r
  window.__nm.bench = r
  console.log('BENCH', JSON.stringify(r))
  updateStat()
}

function updateStat() {
  const layers = useWorker ? [...workerLayers.values()] : [...world.layers.values()]
  let html = `种子 <b>${world.seed}</b> · ${useWorker ? `Worker×${workerCount}${client?.offscreen ? '+OffscreenCanvas' : ''}` : '主线程'}<br/>已生成 wang 层 <b>${layers.length}</b><br/>` +
    layers.map((l) => `· ${l.biome} ${l.mapW}×${l.mapH} 重掷 <b>${l.rerolls}</b> 布景 <b>${l.scenes.length ?? l.scenes}</b> ${l.genMs.toFixed(0)}ms`).join('<br/>') +
    `<br/>${useWorker && streamer ? `常驻区块 <b>${streamer.entries.size}</b>/${streamer.cache} · 已卸载 ${streamer.stats.evicted} · 落盘 ${streamer.stats.persisted} · 存档命中 ${streamer.stats.fromStore}` : `画布缓存 <b>${chunkCanvas.size}</b>`}` +
    (truth.ready ? `<br/>真值:seed ${truth.seed},${truth.chunks.size} 块` : '<br/>真值未加载')
  if (bench.running) html += `<br/><b>跑分中… ${((performance.now() - bench.t0) / 1000).toFixed(0)}/${bench.seconds}s</b>`
  else if (bench.result) {
    const r = bench.result
    html += `<br/><b>跑分:${r.verdict}</b><br/>fps ${r.fps} · 帧 p50 ${r.frame_p50} / p95 ${r.frame_p95} / max ${r.frame_max} ms<br/>>33ms ${r.long33} 帧 · >100ms ${r.long100} 帧 · 黑洞帧 ${r.hole_pct}%<br/>区块 ${r.chunks} 个,到达 p50 ${r.chunk_wait_p50} / p95 ${r.chunk_wait_p95} ms<br/>进群系首块 ${r.first_chunk_ms} ms` +
      (r.worker ? `<br/>worker 内 生成 ${r.chunk_gen_p50} / 渲染 ${r.chunk_paint_p50} ms` : '') + (r.heapMB ? `<br/>JS 堆 ${r.heapMB} MB` : '')
  }
  statEl.innerHTML = html
}
setInterval(() => { if (world) updateStat() }, 1000)

// ── 交互 ──
let drag = null
let digging = false
// 挖洞:右键 / 勾选"挖洞模式"后左键或手指。演示"改过的区块卸载后落盘、回来还在"
async function digAt(clientX, clientY) {
  if (!useWorker || !streamer) return
  const r = view.getBoundingClientRect()
  const [wx, wy] = screenToWorld(clientX - r.left, clientY - r.top)
  await streamer.paintCircle(wx, wy, 14, 0)
  dirty = true
}
stage.addEventListener('contextmenu', (e) => e.preventDefault())
stage.addEventListener('pointerdown', (e) => {
  if (e.button === 2 || $('optDig').checked) { digging = true; digAt(e.clientX, e.clientY); stage.setPointerCapture(e.pointerId); return }
  drag = { x: e.clientX, y: e.clientY }; stage.classList.add('drag'); stage.setPointerCapture(e.pointerId)
})
stage.addEventListener('pointerup', () => { drag = null; digging = false; stage.classList.remove('drag') })
stage.addEventListener('pointercancel', () => { drag = null; digging = false; stage.classList.remove('drag') })
stage.addEventListener('pointermove', (e) => {
  if (digging) { digAt(e.clientX, e.clientY); return }
  if (drag) {
    cam.x -= (e.clientX - drag.x) / cam.z; cam.y -= (e.clientY - drag.y) / cam.z
    drag = { x: e.clientX, y: e.clientY }; dirty = true
  }
  const r = view.getBoundingClientRect()
  const [wx, wy] = screenToWorld(e.clientX - r.left, e.clientY - r.top)
  const cx = Math.floor(wx / CHUNK) + WCX, cy = Math.floor(wy / CHUNK) + WCY
  const cv = readyChunk(cx, cy)
  let mtxt = ''
  if (cv && cv.chunk.mat) {
    const i = (Math.floor(wy) - (cy - WCY) * CHUNK) * CHUNK + (Math.floor(wx) - (cx - WCX) * CHUNK)
    const m = cv.chunk.mat[i]
    mtxt = `材质 <b>${mats.name(m)}</b>`
    const t = truth.chunks.get(cx + ',' + cy)
    if (t) mtxt += ` · 真值 <b>${mats.name(t.mat[i])}</b>`
    const l = cv.chunk.layer
    if (l) {
      const tx = coords.absToWangX(l, Math.floor(wx) + WCX * CHUNK), ty = coords.absToWangY(l, Math.floor(wy) + WCY * CHUNK)
      const c = wangAt(l, tx, ty)
      mtxt += `<br/>wang (${tx},${ty}) #${c >= 0 ? c.toString(16).padStart(6, '0') : '—'}`
    }
  }
  hoverEl.innerHTML = `世界 (${Math.floor(wx)}, ${Math.floor(wy)})<br/>chunk (${cx}, ${cy}) ${world?.biomeAtChunk(cx, cy) || '—'}<br/>${mtxt}`
})
stage.addEventListener('wheel', (e) => {
  e.preventDefault()
  const r = view.getBoundingClientRect()
  const [wx, wy] = screenToWorld(e.clientX - r.left, e.clientY - r.top)
  const f = e.deltaY < 0 ? 1.2 : 1 / 1.2
  cam.z = Math.min(12, Math.max(0.05, cam.z * f))
  const [nx, ny] = screenToWorld(e.clientX - r.left, e.clientY - r.top)
  cam.x += wx - nx; cam.y += wy - ny
  dirty = true
}, { passive: false })
// 双指缩放
let pinch = null
stage.addEventListener('touchstart', (e) => { if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), z: cam.z } }, { passive: true })
stage.addEventListener('touchmove', (e) => {
  if (pinch && e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
    cam.z = Math.min(12, Math.max(0.05, pinch.z * d / pinch.d)); dirty = true
  }
}, { passive: true })
stage.addEventListener('touchend', () => { pinch = null })

const setMode = (m) => {
  mode = m
  if (m === 'truth' || m === 'split' || m === 'diff') ensureTruth()
  for (const [id, mm] of [['mGen', 'gen'], ['mWang', 'wang'], ['mTruth', 'truth'], ['mSplit', 'split'], ['mDiff', 'diff']]) $(id).classList.toggle('active', mm === m)
  dirty = true
}
$('mGen').onclick = () => setMode('gen'); $('mWang').onclick = () => setMode('wang'); $('mTruth').onclick = () => setMode('truth')
$('mSplit').onclick = () => setMode('split'); $('mDiff').onclick = () => setMode('diff')
$('gen').onclick = () => newWorld(parseInt($('seed').value, 10) || 0)
$('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gen').click() })
$('rand').onclick = () => { $('seed').value = String((Math.random() * 2147483647) >>> 0); $('gen').click() }
$('goStart').onclick = () => { cam.x = 0; cam.y = -60; dirty = true }
$('goMine').onclick = () => { cam.x = 400; cam.y = 700; dirty = true }
$('zin').onclick = () => { cam.z = Math.min(12, cam.z * 1.3); dirty = true }
$('zout').onclick = () => { cam.z = Math.max(0.05, cam.z / 1.3); dirty = true }
const repaintAll = async () => {
  const p = { visual: $('optVisual').checked, edges: $('optEdges').checked }
  Object.assign(painter, p)
  if (client) await client.setPaint(p)
  streamer?.clear()
  chunkCanvas.clear(); wangCanvas.clear(); diffCanvas.clear(); dirty = true
}
$('optVisual').onchange = repaintAll; $('optEdges').onchange = repaintAll
$('optGrid').onchange = () => { dirty = true }; $('optScenes').onchange = () => { dirty = true }
$('optWorker').checked = useWorker
$('optWorker').onchange = () => { useWorker = $('optWorker').checked; chunkCanvas.clear(); wangCanvas.clear(); diffCanvas.clear(); preparing.clear(); if (useWorker) ensureClient(world.seed); dirty = true; updateStat() }
$('optAhead').onchange = () => { if (streamer) streamer.ahead = +$('optAhead').value || 0 }
$('optPrefetch').onchange = () => { if (streamer) { const on = $('optPrefetch').checked; streamer.ahead = on ? +$('optAhead').value || 0 : 0; streamer.side = on ? 1 : 0 } }
$('storeFlush').onclick = async () => { const n = await streamer?.flush(); alert(`已落盘 ${n ?? 0} 个改动区块`) }
$('storeClear').onclick = async () => { const n = await store?.clear(world.seed); streamer?.clear(); dirty = true; alert(`已清 ${n ?? 0} 个存档区块`) }
$('bench').onclick = () => startBench(+($('benchSec').value || 20))
$('benchCopy').onclick = () => { if (bench.result) navigator.clipboard?.writeText(JSON.stringify(bench.result, null, 1)) }

if (Q.get('seed')) $('seed').value = Q.get('seed')
newWorld(parseInt($('seed').value, 10) || TRUTH_SEED)
if (Q.get('bench')) {
  // 自动化:等 worker 就绪后跑分,结果挂 window.__nm.bench
  const wait = async () => { if (useWorker) await ensureClient(world.seed); startBench(+Q.get('bench') || 20) }
  setTimeout(wait, 500)
}
