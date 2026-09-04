// ── 人字形 wang 砖生成(stb_herringbone_wang_tile,corner 模式)──
// 逐行对应游戏内 stbhw_generate_image(noita.exe)与 noita-telescope js/stbhw.js。
// 输入:模板 PNG(RGB,头 9 字节藏在末行末尾,异或 i*55 编码);输出:mapW×mapH×3 的 RGB 缓冲。
// 三遍:① 顶点色预填 ② 2×3/3×2 去重复 ③ 人字铺砖(H 砖 2s×s,V 砖 s×2s),每砖 6 顶点色精确匹配,
// 候选 = 第一个匹配 + (NextU() % (vary_x·vary_y))·stride —— 均匀随机。
// 游戏只真正生成 1024×1028,超出部分由调用方平铺(见 wangLayer.js)。

const MAX_W = 300
const MAX_H = 300

export class WangTile {
  constructor(pixels, a, b, c, d, e, f) {
    this.pixels = pixels; this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
  }
}

export class WangTileset {
  constructor() {
    this.isCorner = false
    this.numColor = [0, 0, 0, 0, 0, 0]
    this.shortSideLen = 0
    this.hTiles = []
    this.vTiles = []
    this.numVaryX = 0
    this.numVaryY = 0
  }

  /**
   * 从模板 RGB 数据建砖库(stbhw_build_tileset_from_image)
   * @param {Uint8Array} rgb  w*h*3
   */
  static fromRGB(rgb, w, h) {
    const ts = new WangTileset()
    const header = new Uint8Array(9)
    for (let i = 0; i < 9; i++) {
      const idx = w * 3 - 1 - i
      if (idx >= 0 && idx < rgb.length) header[i] = rgb[idx] ^ ((i * 55) % 256)
    }
    if (header[7] === 0xc0) {
      ts.isCorner = true
      ts.numColor = [header[0], header[1], header[2], header[3], 0, 0]
      ts.numVaryX = header[4]; ts.numVaryY = header[5]; ts.shortSideLen = header[6]
    } else {
      ts.isCorner = false
      ts.numColor = [header[0], header[1], header[2], header[3], header[4], header[5]]
      ts.numVaryX = header[6]; ts.numVaryY = header[7]; ts.shortSideLen = header[8]
    }
    if (ts.shortSideLen <= 0 || ts.shortSideLen > 100) throw new Error('wang 模板头无效')

    const p = { ts, data: rgb, stride: w * 3 }
    const nc = ts.numColor
    let ypos = 2
    if (ts.isCorner) {
      for (let k = 0; k < nc[2]; k++)
        for (let j = 0; j < nc[1]; j++)
          for (let i = 0; i < nc[0]; i++)
            for (let q = 0; q < ts.numVaryY; q++) {
              processRow(p, ypos, false, 0, nc[1] - 1, 0, nc[2] - 1, 0, nc[3] - 1, i, i, j, j, k, k, ts.numVaryX)
              ypos += ts.shortSideLen + 3
            }
      ypos += 2
      for (let k = 0; k < nc[3]; k++)
        for (let j = 0; j < nc[0]; j++)
          for (let i = 0; i < nc[1]; i++)
            for (let q = 0; q < ts.numVaryX; q++) {
              processRow(p, ypos, true, 0, nc[0] - 1, 0, nc[3] - 1, 0, nc[2] - 1, i, i, j, j, k, k, ts.numVaryY)
              ypos += ts.shortSideLen * 2 + 3
            }
    } else {
      for (let k = 0; k < nc[3]; k++)
        for (let j = 0; j < nc[4]; j++)
          for (let i = 0; i < nc[2]; i++)
            for (let q = 0; q < ts.numVaryY; q++) {
              processRow(p, ypos, false, 0, nc[2] - 1, k, k, 0, nc[1] - 1, j, j, 0, nc[0] - 1, i, i, ts.numVaryX)
              ypos += ts.shortSideLen + 3
            }
      ypos += 2
      for (let k = 0; k < nc[3]; k++)
        for (let j = 0; j < nc[4]; j++)
          for (let i = 0; i < nc[5]; i++)
            for (let q = 0; q < ts.numVaryX; q++) {
              processRow(p, ypos, true, 0, nc[0] - 1, i, i, 0, nc[1] - 1, j, j, 0, nc[5] - 1, k, k, ts.numVaryY)
              ypos += ts.shortSideLen * 2 + 3
            }
    }
    return ts
  }
}

function processRow(p, ypos, isV, a0, a1, b0, b1, c0, c1, d0, d1, e0, e1, f0, f1, variants) {
  const s = p.ts.shortSideLen
  const step = isV ? s + 3 : 2 * s + 3
  let xpos = 0
  for (let v = 0; v < variants; v++)
    for (let f = f0; f <= f1; f++)
      for (let e = e0; e <= e1; e++)
        for (let d = d0; d <= d1; d++)
          for (let c = c0; c <= c1; c++)
            for (let b = b0; b <= b1; b++)
              for (let a = a0; a <= a1; a++) {
                parseRect(p, xpos, ypos, a, b, c, d, e, f, isV)
                xpos += step
              }
}

function parseRect(p, xpos, ypos, a, b, c, d, e, f, isV) {
  const s = p.ts.shortSideLen
  const wt = isV ? s : s * 2
  const ht = isV ? s * 2 : s
  const pixels = new Uint8Array(wt * ht * 3)
  xpos += 1; ypos += 1
  for (let j = 0; j < ht; j++) {
    for (let i = 0; i < wt; i++) {
      const src = (ypos + j) * p.stride + (xpos + i) * 3
      const dst = (j * wt + i) * 3
      if (src + 2 < p.data.length) {
        pixels[dst] = p.data[src]; pixels[dst + 1] = p.data[src + 1]; pixels[dst + 2] = p.data[src + 2]
      }
    }
  }
  const t = new WangTile(pixels, a, b, c, d, e, f)
  if (isV) p.ts.vTiles.push(t); else p.ts.hTiles.push(t)
}

/**
 * 生成人字砖图(stbhw_generate_image)。
 * @param {WangTileset} ts
 * @param {import('./NollaPrng.js').NollaPrng} prng  已按游戏方式播种
 * @param {Uint8Array} out  w*h*3 RGB 输出
 * @returns {{tileIndices:Int32Array,xmax:number,ymax:number}|null}
 */
export function generateWang(ts, prng, out, w, h) {
  const s = ts.shortSideLen
  if (s <= 0 || !ts.isCorner) return null // 游戏全部模板都是 corner 模式
  const stride = w * 3 // 缓冲真实行距(按未裁剪的 mapW)
  w = Math.min(w, 1024)
  h = Math.min(h, 1028)
  const xmax = Math.floor(w / s) + 6
  const ymax = Math.floor(h / s) + 6
  const tileIndices = new Int32Array(xmax * ymax)
  const numVary = ts.numVaryX * ts.numVaryY

  const cc = new Int32Array(MAX_W * MAX_H).fill(-1)
  const getC = (x, y) => (x < 0 || x >= MAX_W || y < 0 || y >= MAX_H) ? -1 : cc[y * MAX_W + x]
  const setC = (x, y, v) => { if (x >= 0 && x < MAX_W && y >= 0 && y < MAX_H) cc[y * MAX_W + x] = v }
  const match = (i, j) => getC(i, j) === getC(i + 1, j + 1)
  const changeColor = (old, n) => (old + 1 + (prng.NextU() % (n - 1))) % n

  // ① 顶点色预填
  for (let j = 0; j < ymax; j++)
    for (let i = 0; i < xmax; i++)
      setC(i, j, (prng.NextU() >>> 0) % ts.numColor[(i - j + 1) & 3])

  // ② 去重复
  for (let j = 0; j < ymax - 3; j++) {
    for (let i = 0; i < xmax - 3; i++) {
      if (match(i, j) && match(i, j + 1) && match(i, j + 2) && match(i + 1, j) && match(i + 1, j + 1) && match(i + 1, j + 2)) {
        const p = ((i + 1) - (j + 1) + 1) & 3
        if (ts.numColor[p] > 1) setC(i + 1, j + 1, changeColor(getC(i + 1, j + 1), ts.numColor[p]))
      }
      if (match(i, j) && match(i + 1, j) && match(i + 2, j) && match(i, j + 1) && match(i + 1, j + 1) && match(i + 2, j + 1)) {
        const p = ((i + 2) - (j + 1) + 1) & 3
        if (ts.numColor[p] > 1) setC(i + 2, j + 1, changeColor(getC(i + 2, j + 1), ts.numColor[p]))
      }
    }
  }

  // 选砖:6 顶点精确匹配,first + m*stride
  const choose = (tiles, ax, ay, bx, by, cx, cy, dx, dy, ex, ey, fx, fy) => {
    const a = getC(ax, ay), b = getC(bx, by), c = getC(cx, cy), d = getC(dx, dy), e = getC(ex, ey), f = getC(fx, fy)
    let first = -1, second = -1
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]
      if ((a < 0 || a === t.a) && (b < 0 || b === t.b) && (c < 0 || c === t.c) && (d < 0 || d === t.d) && (e < 0 || e === t.e) && (f < 0 || f === t.f)) {
        if (first < 0) first = i
        else { second = i; break }
      }
    }
    if (first < 0) return -1
    const stride = second === -1 ? 0 : second - first
    const m = prng.NextU() % numVary
    const idx = first + m * stride
    const t = tiles[idx]
    setC(ax, ay, t.a); setC(bx, by, t.b); setC(cx, cy, t.c); setC(dx, dy, t.d); setC(ex, ey, t.e); setC(fx, fy, t.f)
    return idx
  }

  // ③ 人字铺砖
  let yIdx = -1
  let ypos = -s
  for (let j = -1; yIdx * s < h; j++) {
    const phase = j & 3
    let i = phase === 0 ? 0 : phase - 4
    for (; ; i += 4) {
      const xpos = i * s
      if (xpos >= w) break
      if (i + 2 >= 0 && yIdx >= 0) {
        const ti = choose(ts.hTiles, i + 2, j + 2, i + 3, j + 2, i + 4, j + 2, i + 2, j + 3, i + 3, j + 3, i + 4, j + 3)
        if (ti === -1) return null
        if (i >= 0) tileIndices[yIdx * xmax + i] = ti
        if (i + 1 >= 0) tileIndices[yIdx * xmax + i + 1] = ti | 0x8000
        drawTile(out, stride, w, h, xpos, ypos, ts.hTiles[ti], s * 2, s)
      }
      const xv = i + 3
      const xposV = xv * s
      if (xposV < w) {
        const ti = choose(ts.vTiles, i + 5, j + 2, i + 5, j + 3, i + 5, j + 4, i + 6, j + 2, i + 6, j + 3, i + 6, j + 4)
        if (ti === -1) return null
        if (yIdx >= 0) tileIndices[yIdx * xmax + xv] = ti | 0x4000
        if ((yIdx + 1) * s < h + s) tileIndices[(yIdx + 1) * xmax + xv] = ti | 0xc000
        drawTile(out, stride, w, h, xposV, ypos, ts.vTiles[ti], s, s * 2)
      }
    }
    yIdx++
    ypos += s
  }
  return { tileIndices, xmax, ymax }
}

function drawTile(out, stride, w, h, x, y, tile, tw, th) {
  for (let j = 0; j < th; j++) {
    const yy = y + j
    if (yy < 0 || yy >= h) continue
    for (let i = 0; i < tw; i++) {
      const xx = x + i
      if (xx < 0 || xx >= w) continue
      const s = (j * tw + i) * 3
      const d = yy * stride + xx * 3
      out[d] = tile.pixels[s]; out[d + 1] = tile.pixels[s + 1]; out[d + 2] = tile.pixels[s + 2]
    }
  }
}
