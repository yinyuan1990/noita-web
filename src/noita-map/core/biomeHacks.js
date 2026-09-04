// ── wang 层生成后的原版修补 + 连通性校验(逐条对应 GEN-RULES.md §四~§六)──
// 缓冲约定:RGB,宽 mapW,高 mapH+4(顶部 4 行 padding,游戏就是这样),下标 (y*mapW+x)*3。
// 全部在 wang 像素尺度上做(1 px = 10 世界像素)。

import { NollaPrng } from './NollaPrng.js'

const rgbAt = (px, i) => (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]
const put = (px, i, c) => { px[i] = (c >> 16) & 255; px[i + 1] = (c >> 8) & 255; px[i + 2] = c & 255 }

/** 布景锚色:遇到就从 (x+1,y+1) 描出一块矩形房间,校验期间临时封实(pixel_scene_config.BLOCKED_COLORS) */
export const BLOCKED_COLORS = new Set([
  0x00ac6e, 0x70d79e, 0x70d79f, 0x70d7a0, 0x70d7a1, 0x7868ff, 0xc35700, 0xff0080, 0xff00ff, 0xff0aff, 0x00ac64,
])

/** §4.1 房间封锁(仅 coalmine / excavationsite 模板)。返回房间列表供校验后恢复。 */
export function blockOutRooms(px, mapW, outH) {
  const rooms = []
  for (let y = 4; y < outH; y++) {
    for (let x = 0; x < mapW; x++) {
      const c = rgbAt(px, (y * mapW + x) * 3)
      if (c === 0 || c === 0xffffff || !BLOCKED_COLORS.has(c)) continue
      const sx = x + 1, sy = y + 1
      let ex = x + 1, ey = y + 1
      while (ex < mapW) {
        const t = rgbAt(px, (sy * mapW + ex) * 3)
        if (t === 0 || t === 0x323232) { ex++; continue }
        ex--; break
      }
      if (ex >= mapW) ex = mapW - 1
      while (ey < outH) {
        const t = rgbAt(px, (ey * mapW + sx) * 3)
        if (t === 0 || t === 0x323232) { ey++; continue }
        ey--; break
      }
      if (ey >= outH) ey = outH - 1
      if (ex > sx && ey > sy) {
        for (let by = sy; by <= ey; by++) for (let bx = sx; bx <= ex; bx++) put(px, (by * mapW + bx) * 3, 0xff01ff)
      }
      rooms.push({ color: c, startX: sx, startY: sy, endX: ex, endY: ey })
    }
  }
  return rooms
}

export function restoreRooms(px, mapW, rooms) {
  for (const r of rooms)
    for (let y = r.startY; y <= r.endY; y++)
      for (let x = r.startX; x <= r.endX; x++) put(px, (y * mapW + x) * 3, 0)
}

/** §4.2 主群系入口:顶部(含 padding)清 7 宽 × 11 高 */
export function applyMainBiomeHack(startX, px, mapW, outH) {
  for (let y = 0; y < 11; y++)
    for (let x = startX; x < startX + 7; x++)
      if (x < mapW && y < outH) put(px, (y * mapW + x) * 3, 0)
}

/**
 * §4.3 煤矿外框叠加层 extra_layers/coalmine.png(256×103,RGBA):
 * #000042 → 强制空气;#ffffff → 不动;其他非透明 → 实心(校验期),校验后 undo 时改成空气。
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} overlay
 */
export function applyCoalmineOverlay(px, mapW, outH, overlay, undo = false) {
  const H = Math.min(outH, overlay.height), W = Math.min(mapW, overlay.width)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * overlay.width + x) * 4
      if (overlay.data[o + 3] === 0) continue
      const hex = (overlay.data[o] << 16) | (overlay.data[o + 1] << 8) | overlay.data[o + 2]
      const i = ((y + 4) * mapW + x) * 3
      if (hex === 0x000042) put(px, i, 0)
      else if (hex !== 0xffffff) put(px, i, undo ? 0 : 0x010101)
    }
  }
}

// ── §五 连通性校验 ──
const MINES_START = { x: 142, len: 12 }
const PATH_MIN_X = 159, PATH_MAX_X = 223

/** 主路起点:煤矿模板固定;否则区域含世界中心列时按世界 x=159..223 换算 */
export function getPathStartSegment(bbox, mapW, mapH, wangFile, worldCenterChunkX) {
  if (usesMinesTemplate(wangFile)) return MINES_START
  const segLen = Math.trunc((PATH_MAX_X - PATH_MIN_X) / 10)
  const regionX = (bbox[0] - worldCenterChunkX) * 512
  const startX = Math.trunc((PATH_MIN_X - regionX) / 10)
  if (startX < 0 || startX >= mapW) return null
  if (startX + segLen < 0 || startX + segLen >= mapW) return null
  if (mapH < 7) return null
  return { x: startX, len: Math.trunc(segLen / 10) }
}

export const usesMinesTemplate = (wangFile) => !!wangFile && wangFile.endsWith('coalmine.png')

const isOpen = (px, i) => { const c = rgbAt(px, i); return c === 0 || c === 0xc0ffee }

function findSequences(px, mapW, row) {
  const seqs = []
  let start = -1
  for (let x = 0; x < mapW; x++) {
    if (isOpen(px, (row * mapW + x) * 3)) { if (start < 0) start = x }
    else if (start >= 0) { seqs.push({ x: start, len: x - start }); start = -1 }
  }
  if (start >= 0) seqs.push({ x: start, len: mapW - start })
  return seqs
}
const mid = (s) => s.x + Math.trunc(s.len / 2)

/** 顶(第 4 行)→ 底 4 连通 BFS;通了返回路径(wang 像素坐标),否则 null */
export function findMinPath(px, mapW, outH, startSeg) {
  const startY = 4
  const tops = startSeg ? [startSeg] : findSequences(px, mapW, startY)
  if (!tops.length) return null
  const bottoms = findSequences(px, mapW, outH - 1)
  if (!bottoms.length) return null
  const N = mapW * outH
  for (const seg of tops) {
    const sx = mid(seg)
    if (sx < 0 || sx >= mapW) continue
    const visited = new Uint8Array(N)
    const parents = new Int32Array(N).fill(-1)
    const qx = new Int32Array(N), qy = new Int32Array(N)
    let qh = 0, qt = 0
    qx[qt] = sx; qy[qt] = startY; qt++
    visited[startY * mapW + sx] = 1
    parents[startY * mapW + sx] = -2
    let maxY = startY
    while (qh < qt) {
      const cx = qx[qh], cy = qy[qh]; qh++
      if (cy > maxY) maxY = cy
      // 顺序 下、左、右、上(与原版一致,影响 parents 进而影响 clearPath 走到的秘室)
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 1 ? -1 : k === 2 ? 1 : 0)
        const ny = cy + (k === 0 ? 1 : k === 3 ? -1 : 0)
        if (nx < 0 || nx >= mapW || ny <= 3 || ny >= outH) continue
        const ni = ny * mapW + nx
        if (visited[ni] || !isOpen(px, ni * 3)) continue
        visited[ni] = 1
        parents[ni] = cy * mapW + cx
        qx[qt] = nx; qy[qt] = ny; qt++
      }
    }
    if (maxY < outH - 1) continue
    let endIdx = -1
    for (const b of bottoms) {
      const ex = mid(b)
      if (ex >= 0 && ex < mapW && visited[(outH - 1) * mapW + ex]) { endIdx = (outH - 1) * mapW + ex; break }
    }
    if (endIdx === -1) continue
    const path = []
    let cur = endIdx
    while (cur !== -2 && cur !== -1) {
      path.push({ x: cur % mapW, y: Math.floor(cur / mapW) })
      const p = parents[cur]
      if (p === -2) break
      cur = p
    }
    return path.reverse()
  }
  return null
}

// ── §六 收尾 ──
function floodReplace(px, mapW, outH, x0, y0, from, to) {
  const stack = [x0, y0]
  put(px, (y0 * mapW + x0) * 3, to)
  while (stack.length) {
    const cy = stack.pop(), cx = stack.pop()
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0)
      if (nx < 0 || nx >= mapW || ny < 0 || ny >= outH) continue
      const i = (ny * mapW + nx) * 3
      if (rgbAt(px, i) !== from) continue
      put(px, i, to)
      stack.push(nx, ny)
    }
  }
}

/** 6.1 主路上踩到的 c0ffee 连通区全部变空气 */
export function clearPath(px, mapW, outH, path) {
  for (const p of path) {
    if (p.x < 0 || p.x >= mapW || p.y < 0 || p.y >= outH) continue
    if (rgbAt(px, (p.y * mapW + p.x) * 3) === 0xc0ffee) floodReplace(px, mapW, outH, p.x, p.y, 0xc0ffee, 0)
  }
}

/** 6.2 咖啡色秘室:每个连通区 50/50 → 空气/墙(白) */
export function applyCoffeeHack(px, mapW, outH, worldSeed) {
  const prng = new NollaPrng(0)
  prng.SetRandomFromWorldSeed(worldSeed)
  prng.Next()
  for (let y = 4; y < outH; y++)
    for (let x = 0; x < mapW; x++)
      if (rgbAt(px, (y * mapW + x) * 3) === 0xc0ffee) {
        const to = prng.Next() < 0.5 ? 0xffffff : 0
        floodReplace(px, mapW, outH, x, y, 0xc0ffee, to)
      }
}

/** 6.3 RandomMaterials:某色整块随机换成备选色(liquidcave 等,coalmine 无) */
export function applyRandomColors(px, mapW, outH, worldSeed, ngPlus, randomColors) {
  for (const [colorStr, options] of Object.entries(randomColors)) {
    const color = +colorStr
    const prng = new NollaPrng(0)
    prng.SetRandomFromWorldSeed(worldSeed + ngPlus)
    prng.Next()
    const s = worldSeed + ngPlus
    const iters = mapW + s - 11 * Math.floor(mapW / 11) - 12 * Math.floor(s / 12)
    for (let i = 0; i < iters; i++) prng.Next()
    prng.Next()
    for (let y = 4; y < outH; y++)
      for (let x = 0; x < mapW; x++)
        if (rgbAt(px, (y * mapW + x) * 3) === color) {
          const to = options[Math.floor(prng.Next() * options.length)]
          floodReplace(px, mapW, outH, x, y, color, to)
        }
  }
}
