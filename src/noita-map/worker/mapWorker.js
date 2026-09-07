// ── 地图 Worker:整套生成 + 渲染都在这里跑,主线程只收 ImageBitmap / 材质数组 ──
// 这是"手机不卡"的根本手段:一个区块 30~150ms 的生成不再挤占主线程的 16ms 帧预算。
// core/ 无 DOM,所以能原样 import;渲染用 OffscreenCanvas(没有就退回只回传材质,由主线程画)。
import { NoitaAssets } from '../assets.js'
import { NoitaWorld } from '../World.js'
import { ChunkPainter } from '../render/ChunkPainter.js'

let assets = null, world = null, painter = null
const HAS_OC = typeof OffscreenCanvas !== 'undefined'
const oc = HAS_OC ? new OffscreenCanvas(512, 512) : null

self.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.cmd === 'init') {
      assets = await new NoitaAssets({ base: m.base }).init()
      painter = new ChunkPainter(assets, m.paint || {})
      world = new NoitaWorld(assets, m.seed, { chunkCache: m.chunkCache || 32 })
      self.postMessage({ type: 'ready', id: m.id, offscreen: HAS_OC })
    } else if (m.cmd === 'seed') {
      world = new NoitaWorld(assets, m.seed, { chunkCache: m.chunkCache || 32 })
      self.postMessage({ type: 'ready', id: m.id, offscreen: HAS_OC })
    } else if (m.cmd === 'paint') {
      Object.assign(painter, m.paint)
      self.postMessage({ type: 'ok', id: m.id })
    } else if (m.cmd === 'globals') {
      Object.assign(world.globals, m.globals || {})
      self.postMessage({ type: 'ok', id: m.id })
    } else if (m.cmd === 'chunk') {
      const { cx, cy, id } = m
      const t0 = performance.now()
      await world.prepareChunk(cx, cy)
      const t1 = performance.now()
      let chunk = world.getChunk(cx, cy)
      // 存档命中(玩家改过的区块):布景/群系照旧算(确定性),材质换成存的那份
      if (m.mat) {
        chunk = { ...chunk, mat: m.mat }
        // 重画 / 读档:植被落点用主线程 / 存档带来的(m.veg),不按被挖过的地面重算,也不再往材质里烙(材质里已经有了)
        world.attachDecor(chunk, { veg: m.veg || chunk.decor?.filter((d) => d.kind === 'veg') || [], stamp: false })
        world.chunks.set(cx + ',' + cy, { ...chunk, t: ++world._tick })
      }
      const t2 = performance.now()
      await painter.prepare(chunk)
      let bitmap = null, pixels = null
      if (HAS_OC && m.wantBitmap !== false) {
        painter.paint(chunk, oc)
        // raw:要裸像素(主线程按脏块 putImageData 进常驻画布,不整张换位图);否则整张 ImageBitmap
        if (m.raw) pixels = oc.getContext('2d').getImageData(0, 0, oc.width, oc.height).data
        else bitmap = oc.transferToImageBitmap()
      }
      const t3 = performance.now()
      const mat = m.wantMat ? chunk.mat.slice() : null
      const transfer = []
      if (mat) transfer.push(mat.buffer)
      if (bitmap) transfer.push(bitmap)
      if (pixels) transfer.push(pixels.buffer)
      self.postMessage({
        type: 'chunk', id, cx, cy, biome: chunk.biome, kind: chunk.kind,
        scenes: chunk.scenes, lights: chunk.lights || [], decor: chunk.decor || [], spawns: chunk.spawns || [], spillUp: !!chunk.spillUp, mat, bitmap, pixels,
        timing: { prepare: t1 - t0, gen: t2 - t1, paint: t3 - t2 },
        layerInfo: chunk.layer ? { biome: chunk.layer.biome, mapW: chunk.layer.mapW, mapH: chunk.layer.mapH, rerolls: chunk.layer.rerolls, scenes: chunk.layer.scenes.length, genMs: chunk.layer.genMs } : null,
      }, transfer)
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) })
  }
}
