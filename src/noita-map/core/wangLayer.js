// ── 一个群系区域 → wang RGB 层(完整原版管线,telescope tile_generator.generateBiomeTiles 单区域版)──
// 播种 → 人字拼砖 → 房间封锁/入口/外框 → 顶到底 BFS(不通换种子,≤99 次)→ 恢复房间/外框 → 清主路/秘室掷骰/随机色
// → 1024 平铺扩展 → 非区域 chunk 遮黑。
// 输出 layer 供 materialize / scenes 用。全部纯 TypedArray,可在 Worker / 手机跑。

import { NollaPrng } from './NollaPrng.js'
import { generateWang } from './stbhw.js'
import {
  blockOutRooms, restoreRooms, applyMainBiomeHack, applyCoalmineOverlay, getPathStartSegment,
  usesMinesTemplate, findMinPath, clearPath, applyCoffeeHack, applyRandomColors,
} from './biomeHacks.js'
import { mapDimensions, correctedOrigin, TILE, WORLD_CENTER_CHUNK_X } from './coords.js'

const MAX_ATTEMPTS = 99
const PATH_HEIGHT_LIMIT_CHUNKS = 4

function generateRaw(bbox, tileset, worldSeed, ngPlus, extraRerolls, wangFile, overlay) {
  const { width: mapW, height: mapH } = mapDimensions(bbox)
  const outH = mapH + 4
  const prng = new NollaPrng(0)
  prng.SetRandomFromWorldSeed(worldSeed + ngPlus)
  prng.Next()
  // 与游戏一致的"预热"次数:1024 以内的宽 + 种子 的怪异组合
  const effW = Math.min(mapW, 1024)
  const s = worldSeed + ngPlus
  const iters = effW + s - 11 * Math.floor(effW / 11) - 12 * Math.floor(s / 12)
  for (let i = 0; i < iters; i++) prng.Next()
  for (let i = 0; i < extraRerolls; i++) prng.Next()
  prng.Seed = prng.NextU()
  prng.Next()

  const buffer = new Uint8Array(mapW * outH * 3)
  const gen = generateWang(tileset, prng, buffer, mapW, outH)
  if (!gen) return null

  const isMines = usesMinesTemplate(wangFile)
  let rooms = []
  if (isMines || (wangFile && wangFile.endsWith('excavationsite.png'))) rooms = blockOutRooms(buffer, mapW, outH)
  const pathStart = getPathStartSegment(bbox, mapW, mapH, wangFile, WORLD_CENTER_CHUNK_X)
  if (pathStart && !isMines) applyMainBiomeHack(pathStart.x, buffer, mapW, outH)
  if (isMines && overlay) applyCoalmineOverlay(buffer, mapW, outH, overlay, false)
  return { buffer, mapW, mapH, outH, rooms, pathStart, tileIndices: gen.tileIndices, xmax: gen.xmax, ymax: gen.ymax }
}

/**
 * @param {object} o
 * @param {string} o.biome         群系名
 * @param {Array<[number,number]>} o.points  区域内 chunk 坐标(群系图像素)
 * @param {[number,number,number,number]} o.bbox
 * @param {import('./stbhw.js').WangTileset} o.tileset
 * @param {string} o.wangFile      模板文件名(决定煤矿/挖掘场特判)
 * @param {object|null} o.overlay  extra_layers/coalmine.png RGBA
 * @param {number} o.seed
 * @param {number} [o.ngPlus]
 * @param {object} [o.randomColors]
 */
export function generateRegionLayer(o) {
  const { biome, points, bbox, tileset, wangFile, overlay, seed, ngPlus = 0, randomColors = null } = o
  let rerolls = 0, attempts = 0, raw = null, path = null
  const tall = 1 + bbox[3] - bbox[1] > PATH_HEIGHT_LIMIT_CHUNKS
  while (attempts < MAX_ATTEMPTS) {
    raw = generateRaw(bbox, tileset, seed, ngPlus, rerolls, wangFile, overlay)
    if (!raw) return null
    const p = tall ? [] : findMinPath(raw.buffer, raw.mapW, raw.outH, raw.pathStart)
    if (p) { path = p; break }
    rerolls++; attempts++
  }
  if (attempts === MAX_ATTEMPTS) {
    raw = generateRaw(bbox, tileset, seed, ngPlus, rerolls, wangFile, overlay)
    path = []
  }
  const { buffer, mapW, outH } = raw
  restoreRooms(buffer, mapW, raw.rooms)
  if (usesMinesTemplate(wangFile) && overlay) applyCoalmineOverlay(buffer, mapW, outH, overlay, true)
  clearPath(buffer, mapW, outH, path)
  applyCoffeeHack(buffer, mapW, outH, seed)
  if (randomColors) applyRandomColors(buffer, mapW, outH, seed, ngPlus, randomColors)

  // 游戏只生成 1024×1028,更大的区域按 1024 周期平铺
  if (mapW > 1024 || outH > 1028) {
    for (let y = 4; y < outH; y++)
      for (let x = 0; x < mapW; x++) {
        if (x < 1024 && y < 1028) continue
        const sx = x % 1024, sy = 4 + ((y - 4) % 1024)
        const si = (sy * mapW + sx) * 3, di = (y * mapW + x) * 3
        buffer[di] = buffer[si]; buffer[di + 1] = buffer[si + 1]; buffer[di + 2] = buffer[si + 2]
      }
  }

  // 非区域 chunk 遮黑(包围盒内但不属于该连通块的格子)
  const valid = new Set(points.map((p) => p[0] + ',' + p[1]))
  const [minCX, minCY, maxCX, maxCY] = bbox
  let tx = 0
  for (let cx = minCX; cx <= maxCX; cx++) {
    const cw = 51 + (cx % 5 === 4 ? 1 : 0)
    let ty = 0
    for (let cy = minCY; cy <= maxCY; cy++) {
      const ch = 51 + (cy % 5 === 4 ? 1 : 0)
      if (!valid.has(cx + ',' + cy)) {
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const i = ((ty + y + 4) * mapW + tx + x) * 3
          buffer[i] = 0; buffer[i + 1] = 0; buffer[i + 2] = 0
        }
      }
      ty += ch
    }
    tx += cw
  }

  const origin = correctedOrigin(minCX, minCY)
  return {
    biome,
    wangFile,
    buffer, mapW, mapH: raw.mapH, outH,
    minChunkX: minCX, minChunkY: minCY, bbox,
    validChunks: valid,
    // 该层 wang(0,0)(去 padding)对应的 chunk 绝对坐标;1 wang px = 10 世界像素
    originX: origin.x, originY: origin.y,
    w: mapW * TILE, h: raw.mapH * TILE,
    path, rerolls,
    rooms: raw.rooms,
  }
}

/** 读 wang 像素(自动跳过 4 行 padding);越界返回 -1 */
export function wangAt(layer, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= layer.mapW || ty >= layer.mapH) return -1
  const i = ((ty + 4) * layer.mapW + tx) * 3
  return (layer.buffer[i] << 16) | (layer.buffer[i + 1] << 8) | layer.buffer[i + 2]
}
