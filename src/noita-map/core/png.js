// ── 精确 PNG 解码(纯 JS,零依赖)──
// 为什么不用 <img>+canvas:浏览器会按 gAMA/iCCP/sRGB 块做色彩管理,再加 alpha 预乘,
// 0x000042 这种 wang 色会被改成 0x000043 —— 整套"按色查材质/查 spawn 函数"就全错了(telescope 同样踩过,见 png_sanitizer.js)。
// 支持:8 位 灰/RGB/调色板/灰A/RGBA + 1/2/4 位调色板 + tRNS;Adam7 隔行。输出 {width,height,data:Uint8Array RGBA}。
// inflate 用内置 DecompressionStream,没有时退到自带的小实现(老 WebView / 小游戏环境)。

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export async function decodePng(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  for (let i = 0; i < 8; i++) if (u8[i] !== SIG[i]) throw new Error('不是 PNG')
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let off = 8
  let width = 0, height = 0, depth = 8, ctype = 6, interlace = 0
  let palette = null, trns = null
  const idat = []
  let idatLen = 0
  while (off < u8.length) {
    const len = dv.getUint32(off)
    const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7])
    const data = u8.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = dv.getUint32(off + 8); height = dv.getUint32(off + 12)
      depth = u8[off + 16]; ctype = u8[off + 17]; interlace = u8[off + 20]
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') { idat.push(data); idatLen += len }
    else if (type === 'IEND') break
    off += len + 12
  }
  const z = new Uint8Array(idatLen)
  let p = 0
  for (const d of idat) { z.set(d, p); p += d.length }
  const raw = await inflateZlib(z)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]
  const bpp = Math.max(1, (channels * depth) >> 3) // 每像素字节(滤波用)
  const out = new Uint8Array(width * height * 4)

  const decodePass = (src, sOff, pw, ph, put) => {
    const stride = Math.ceil((pw * channels * depth) / 8)
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride)
    let pos = sOff
    for (let y = 0; y < ph; y++) {
      const ft = src[pos++]
      cur.set(src.subarray(pos, pos + stride)); pos += stride
      unfilter(ft, cur, prev, bpp)
      put(cur, y, pw)
      const t = prev; prev = cur; cur = t
    }
    return pos
  }
  const writePixel = (x, y, r, g, b, a) => { const o = (y * width + x) * 4; out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a }
  const rowToPixels = (row, pw, xOf, y) => {
    for (let x = 0; x < pw; x++) {
      let r, g, b, a = 255
      if (depth === 8) {
        const i = x * channels
        if (ctype === 6) { r = row[i]; g = row[i + 1]; b = row[i + 2]; a = row[i + 3] }
        else if (ctype === 2) { r = row[i]; g = row[i + 1]; b = row[i + 2]; if (trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5]) a = 0 }
        else if (ctype === 0) { r = g = b = row[i]; if (trns && trns.length >= 2 && r === trns[1]) a = 0 }
        else if (ctype === 4) { r = g = b = row[i]; a = row[i + 1] }
        else { const pi = row[i]; r = palette[pi * 3]; g = palette[pi * 3 + 1]; b = palette[pi * 3 + 2]; a = trns && pi < trns.length ? trns[pi] : 255 }
      } else if (depth === 16) {
        const i = x * channels * 2
        if (ctype === 6) { r = row[i]; g = row[i + 2]; b = row[i + 4]; a = row[i + 6] }
        else if (ctype === 2) { r = row[i]; g = row[i + 2]; b = row[i + 4] }
        else if (ctype === 4) { r = g = b = row[i]; a = row[i + 2] }
        else { r = g = b = row[i] }
      } else {
        // 1/2/4 位(灰或调色板)
        const bitPos = x * depth
        const v = (row[bitPos >> 3] >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1)
        if (ctype === 3) { r = palette[v * 3]; g = palette[v * 3 + 1]; b = palette[v * 3 + 2]; a = trns && v < trns.length ? trns[v] : 255 }
        else { r = g = b = Math.round((v * 255) / ((1 << depth) - 1)) }
      }
      writePixel(xOf(x), y, r, g, b, a)
    }
  }
  if (!interlace) {
    decodePass(raw, 0, width, height, (row, y, pw) => rowToPixels(row, pw, (x) => x, y))
  } else {
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    let pos = 0
    for (const [x0, y0, dx, dy] of passes) {
      const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy)
      if (pw <= 0 || ph <= 0) continue
      pos = decodePass(raw, pos, pw, ph, (row, y, w) => rowToPixels(row, w, (x) => x0 + x * dx, y0 + y * dy))
    }
  }
  return { width, height, data: out }
}

function unfilter(ft, cur, prev, bpp) {
  const n = cur.length
  if (ft === 0) return
  if (ft === 1) { for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255 }
  else if (ft === 2) { for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 255 }
  else if (ft === 3) { for (let i = 0; i < n; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 255 }
  else if (ft === 4) {
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
    }
  }
}

async function inflateZlib(z) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate')
      const w = ds.writable.getWriter(); w.write(z); w.close()
      const ab = await new Response(ds.readable).arrayBuffer()
      return new Uint8Array(ab)
    } catch (e) { void e }
  }
  return inflateRaw(z.subarray(2)) // 跳过 zlib 2 字节头;末尾 adler32 不校验
}

// ── 极简 inflate(RFC1951),够解 PNG 用 ──
function inflateRaw(src) {
  let out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0
  let ip = 0, bitBuf = 0, bitCnt = 0
  const bits = (n) => {
    while (bitCnt < n) { bitBuf |= src[ip++] << bitCnt; bitCnt += 8 }
    const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v
  }
  const ensure = (n) => { if (op + n > out.length) { const o2 = new Uint8Array(Math.max(out.length * 2, op + n)); o2.set(out); out = o2 } }
  // 规范哈夫曼(puff.c 做法):按码长计数 → 每个码长的起始下标 → 按符号序填入
  const buildHuff = (lengths) => {
    const maxLen = Math.max(1, ...lengths)
    const count = new Uint16Array(maxLen + 1), offs = new Uint16Array(maxLen + 2)
    for (const l of lengths) if (l) count[l]++
    for (let len = 1; len <= maxLen; len++) offs[len + 1] = offs[len] + count[len]
    const symbols = new Uint16Array(lengths.length)
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbols[offs[lengths[s]]++] = s
    return { count, symbols, maxLen }
  }
  const decodeSym = (h) => {
    let code = 0, first = 0, index = 0
    for (let len = 1; len <= h.maxLen; len++) {
      code |= bits(1)
      const c = h.count[len]
      if (code - c < first) return h.symbols[index + (code - first)]
      index += c; first += c; first <<= 1; code <<= 1
    }
    throw new Error('inflate: 坏的哈夫曼码')
  }
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
  let fixedL = null, fixedD = null
  for (;;) {
    const final = bits(1), type = bits(2)
    if (type === 0) {
      ip -= bitCnt >> 3; bitBuf = 0; bitCnt = 0 // 退回已预读但未用的整字节,对齐到字节边界
      const len = src[ip] | (src[ip + 1] << 8); ip += 4
      ensure(len); out.set(src.subarray(ip, ip + len), op); op += len; ip += len
    } else {
      let hl, hd
      if (type === 1) {
        if (!fixedL) {
          const l = new Array(288).fill(8); for (let i = 144; i < 256; i++) l[i] = 9; for (let i = 256; i < 280; i++) l[i] = 7
          fixedL = buildHuff(l); fixedD = buildHuff(new Array(30).fill(5))
        }
        hl = fixedL; hd = fixedD
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4
        const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
        const cl = new Array(19).fill(0)
        for (let i = 0; i < ncode; i++) cl[order[i]] = bits(3)
        const hc = buildHuff(cl)
        const lengths = []
        while (lengths.length < nlen + ndist) {
          const sym = decodeSym(hc)
          if (sym < 16) lengths.push(sym)
          else if (sym === 16) { const p = lengths[lengths.length - 1]; for (let r = bits(2) + 3; r > 0; r--) lengths.push(p) }
          else if (sym === 17) { for (let r = bits(3) + 3; r > 0; r--) lengths.push(0) }
          else { for (let r = bits(7) + 11; r > 0; r--) lengths.push(0) }
        }
        hl = buildHuff(lengths.slice(0, nlen)); hd = buildHuff(lengths.slice(nlen))
      }
      for (;;) {
        const sym = decodeSym(hl)
        if (sym < 256) { ensure(1); out[op++] = sym }
        else if (sym === 256) break
        else {
          const li = sym - 257
          const len = LBASE[li] + bits(LEXT[li])
          const di = decodeSym(hd)
          const dist = DBASE[di] + bits(DEXT[di])
          ensure(len)
          for (let i = 0; i < len; i++) { out[op] = out[op - dist]; op++ }
        }
      }
    }
    if (final) break
  }
  return out.subarray(0, op)
}
