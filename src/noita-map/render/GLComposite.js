// ── WebGL 世界合成(反 data/shaders/post_final.frag):区块位图 + 材质叠层 + 顶层(粒子 / 精灵 / 实体 / 人)→ × 光照 → 垫天空 / 黑底 → 液体折射 → 放大到屏幕,一次 draw ──
// 之前这些全在 2D 画布上做:6 张区块 drawImage、JS 逐像素算液体 / 沙 / 气 / 火的叠层再 putImageData(手机上 4ms)、multiply 乘光图、destination-in 抠 alpha、
// destination-over 垫天空、fillRect 垫黑、再 drawImage 放大到屏幕 —— iPhone 上"世界" 3.5~4.4ms + "乘光 + 天空" 2ms + "贴屏" 4~6ms,全是 CPU 光栅整屏。
// 现在 GPU 上算:
//   区块:每块一张 512² RGBA 纹理(Worker 画好的 ImageBitmap 第一次用时上传;重画只 texSubImage2D 脏的 32×32 块),视口最多跨 2×2 块 → 4 张
//   材质叠层:视口 VW×VH 的材质 id(LUMINANCE_ALPHA:L = id,A = 燃烧中)每帧上传,shader 查 256 色调色板(色 / alpha / 种类 / 发光)按老 JS 循环的规则算色:
//     沙 = 按世界坐标 hash 抖 ±14% 亮度;火 = 每帧随机橙黄闪;气 alpha ≤ 140;燃烧中(非气非火)加红;燃烧的木头(静态 + aux)= 橙半透
//   顶层:view 画布(碎屑 / 火花 / 弹丸精灵 / 灯 / 植被 / 实体 / 人),每帧一张纹理
//   合成:premultiplied over(顶层 over 叠层 over 区块)→ 老 2D 路径的乘光公式 a·L·(a·fg + 1 − a) + (1 − a)·bg(multiply + destination-in + destination-over 的等价)
//   折射(ENABLE_REFRACTION 原式):液体格在屏幕分辨率下亚像素采样偏 0.85 世界像素,采样到的那格也得是液体(直接查叠层材质的种类,不再单传掩码)
// 屏幕画布就是 WebGL 画布(#game),瞄准圈 / 指引箭头另画在 #ui 上。
import { CHUNK } from '../core/coords.js'

const UPLOADED = { gl: true } // e.bitmap 上传成纹理后放这个标记(render 只看 e.bitmap 真假)

export class GLComposite {
  /** @param {HTMLCanvasElement} canvas 屏幕画布 */
  constructor(canvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: false, depth: false, stencil: false })
    this.gl = gl
    if (!gl) return
    if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 12) return // 顶层 / 光 / 天空 / 材质 / 燃烧 / 调色板 + 2×3 张区块 = 12 个采样器(WebGL1 只保证 8;iOS / 桌面都是 16)
    const vs = `attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(a, 0.0, 1.0); }`
    const fs = `precision highp float; varying vec2 v;
      uniform sampler2D uTop, uLight, uSky, uMat, uAux, uPal, uC0, uC1, uC2, uC3, uC4, uC5;
      uniform vec2 uVP, uOrg, uCorg, uCam; uniform float uTime, uSkyOn, uRefr, uPalH;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // 材质 id 16 位:LUMINANCE = 低字节,ALPHA = 高字节;调色板 256 列 × 2H 行,色在第 hi 行、种类等在第 H+hi 行
      vec2 palCol(vec2 la) { return vec2(la.x, (floor(la.y * 255.0 + 0.5) + 0.5) / (2.0 * uPalH)); }
      vec2 palInfo(vec2 la) { return vec2(la.x, (uPalH + floor(la.y * 255.0 + 0.5) + 0.5) / (2.0 * uPalH)); }
      // 叠层材质种类(0 空 1 静态 2 沙 3 液 4 气 5 火)
      float kindAt(vec2 t) { vec2 mt = (floor(t * uVP) + 0.5) / uVP; return floor(texture2D(uPal, palInfo(texture2D(uMat, mt).ra)).r * 255.0 + 0.5); }
      // 视口最多跨 2 列 × 3 行区块:[C0 C1 / C2 C3 / C4 C5]
      vec4 chunkAt(vec2 w) {
        vec2 rel = w - uCorg; vec2 t = (floor(mod(rel, ${CHUNK}.0)) + 0.5) / ${CHUNK}.0;
        bool r = rel.x >= ${CHUNK}.0; float row = floor(rel.y / ${CHUNK}.0);
        if (row < 0.5) return r ? texture2D(uC1, t) : texture2D(uC0, t);
        if (row < 1.5) return r ? texture2D(uC3, t) : texture2D(uC2, t);
        return r ? texture2D(uC5, t) : texture2D(uC4, t);
      }
      void main(){
        float m0 = uRefr * step(2.5, kindAt(v)) * step(kindAt(v), 3.5);
        vec2 off = vec2( m0 * sin(uTime * 10.0 + (v.x + uCam.x / uVP.x) * 50.0) * 0.002,
                         m0 * cos(uTime * 10.0 + (v.y + uCam.y / uVP.y) * 50.0) * 0.002 );
        float k2 = kindAt(v + off); off *= step(2.5, k2) * step(k2, 3.5);
        vec2 s = v + off;
        vec2 px = floor(s * uVP);            // 视口像素
        vec2 w = uOrg + px;                  // 世界像素
        vec2 mt = (px + 0.5) / uVP;
        // 材质叠层
        vec2 la = texture2D(uMat, mt).ra; float aux = texture2D(uAux, mt).r;
        vec4 pal = texture2D(uPal, palCol(la)); vec3 p2 = texture2D(uPal, palInfo(la)).rgb;
        float kind = floor(p2.r * 255.0 + 0.5), isFire = p2.b;
        vec4 mc = vec4(0.0);
        if (kind >= 2.0) {
          vec3 c = pal.rgb; float a = pal.a;
          if (isFire > 0.5) { c = vec3(1.0, (140.0 + 90.0 * hash(w + uTime * 7.0)) / 255.0, 40.0 / 255.0); a = 0.7 + 0.3 * hash(w * 1.7 + uTime * 3.0); }
          else if (kind == 4.0) a = min(a, 140.0 / 255.0);
          else if (kind == 2.0) c *= 0.86 + 0.28 * hash(w);
          if (aux > 0.0 && kind != 5.0 && kind != 4.0) { c.r = min(1.0, c.r + 120.0 / 255.0); c.g = min(1.0, c.g + 40.0 / 255.0); }
          mc = vec4(c, a);
        } else if (kind == 1.0 && aux > 0.0) mc = vec4(1.0, 120.0 / 255.0, 30.0 / 255.0, 150.0 / 255.0);
        // premultiplied over:顶层 over 叠层 over 区块
        vec4 ch = chunkAt(w);
        vec3 pm = ch.rgb * ch.a; float pa = ch.a;
        pm = mc.rgb * mc.a + pm * (1.0 - mc.a); pa = mc.a + pa * (1.0 - mc.a);
        vec4 tp = texture2D(uTop, s);
        pm = tp.rgb * tp.a + pm * (1.0 - tp.a); pa = tp.a + pa * (1.0 - tp.a);
        vec3 fg = pa > 0.0 ? pm / pa : vec3(0.0); float a = pa;
        vec3 lt = texture2D(uLight, s).rgb;
        vec3 bg = vec3(6.0, 7.0, 10.0) / 255.0;
        if (uSkyOn > 0.5) { vec4 sk = texture2D(uSky, s); bg = mix(bg, sk.rgb, sk.a); }
        gl_FragColor = vec4(a * lt * (a * fg + (1.0 - a)) + (1.0 - a) * bg, 1.0);
      }`
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh }
    const prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    this.u = {}
    for (const n of ['uTime', 'uCam', 'uVP', 'uOrg', 'uCorg', 'uSkyOn', 'uRefr', 'uPalH']) this.u[n] = gl.getUniformLocation(prog, n)
    this.UNIT = { top: 0, light: 1, sky: 2, mat: 3, aux: 4, pal: 5, c0: 6 }
    ;['uTop', 'uLight', 'uSky', 'uMat', 'uAux', 'uPal', 'uC0', 'uC1', 'uC2', 'uC3', 'uC4', 'uC5'].forEach((n, i) => gl.uniform1i(gl.getUniformLocation(prog, n), i))
    const tex = (filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return { t, w: 0, h: 0 } }
    this._tex = tex
    // 光图 LINEAR:原 2D 路径 imageSmoothingEnabled=true 把 1/4 分辩率光图双线性拉到整屏;其余 NEAREST(像素画)
    this.texTop = tex(gl.NEAREST); this.texLight = tex(gl.LINEAR); this.texSky = tex(gl.NEAREST); this.texMat = tex(gl.NEAREST); this.texAux = tex(gl.NEAREST); this.texPal = tex(gl.NEAREST)
    // 空区块(还没到的)= 1×1 透明
    this.texEmpty = tex(gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    this.chunks = new Map() // key → {t}
    this.stats = { chunkUp: 0, patchPx: 0 }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    this.ok = true
  }

  /** 同步计时用:读 1 像素逼 GPU 把这帧画完 */
  sync() { const gl = this.gl; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._px ||= new Uint8Array(4)) }

  resize(sw, sh) {
    if (!this.ok) return
    this.canvas.width = sw; this.canvas.height = sh
    this.gl.viewport(0, 0, sw, sh)
  }

  /**
   * 材质调色板:256 列 × 2H 行 RGBA(H = ceil(材质数 / 256),id = hi·256 + lo → 列 lo)。前 H 行 = 叠层色 rgb + alpha(沙 255,其余 materials.xml 的 alpha,再加 gfx_glow 截 255);
   * 后 H 行 = (种类, glow, 是否火)
   * @param {{color:Int32Array|number[], alpha:Uint8Array|number[]}} mats  @param {Uint8Array} kind  @param {Uint8Array} glow  @param {number} fireId
   */
  setPalette(mats, kind, glow, fireId) {
    const gl = this.gl, H = Math.max(1, Math.ceil(kind.length / 256)), d = new Uint8Array(256 * 2 * H * 4)
    for (let m = 0; m < kind.length; m++) {
      const c = mats.color[m] || 0, k = kind[m] || 0
      let a = k === 2 ? 255 : (mats.alpha[m] ?? 255)
      if (glow[m]) a = Math.min(255, a + glow[m])
      const lo = m & 255, hi = m >> 8, o1 = (hi * 256 + lo) * 4, o2 = ((H + hi) * 256 + lo) * 4
      d[o1] = (c >> 16) & 255; d[o1 + 1] = (c >> 8) & 255; d[o1 + 2] = c & 255; d[o1 + 3] = a
      d[o2] = k; d[o2 + 1] = glow[m] || 0; d[o2 + 2] = m === fireId ? 255 : 0; d[o2 + 3] = 255
    }
    gl.activeTexture(gl.TEXTURE0 + this.UNIT.pal); gl.bindTexture(gl.TEXTURE_2D, this.texPal.t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 2 * H, 0, gl.RGBA, gl.UNSIGNED_BYTE, d)
    gl.uniform1f(this.u.uPalH, H)
  }

  /** 画布 / ImageData 上传:尺寸没变走 texSubImage2D(不重新分配) */
  _up(unit, T, src, fmt = this.gl.RGBA) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, T.t)
    if (T.w === src.width && T.h === src.height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fmt, gl.UNSIGNED_BYTE, src)
    else { gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, src); T.w = src.width; T.h = src.height }
  }

  /** VW×VH 字节表(材质 id 双字节 / 燃烧标记单字节)→ LUMINANCE(_ALPHA) 纹理 */
  _upBytes(unit, T, data, w, h, fmt) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, T.t)
    if (T.w === w && T.h === h) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, fmt, gl.UNSIGNED_BYTE, data)
    else { gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, data); T.w = w; T.h = h }
  }

  /** 区块纹理:第一次用时把 e.bitmap(ImageBitmap)上传并关掉;之后 Worker 重画的脏块(ChunkStreamer 放在 e.glPatches)texSubImage2D 补上 */
  chunk(e) {
    const gl = this.gl
    let T = this.chunks.get(e.key)
    if (!T) {
      if (!e.bitmap || e.bitmap === UPLOADED) return null
      T = this._tex(gl.NEAREST); this.chunks.set(e.key, T)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, e.bitmap)
      e.bitmap.close?.(); e.bitmap = UPLOADED
      this.stats.chunkUp++
    } else if (e.glPatches) gl.bindTexture(gl.TEXTURE_2D, T.t)
    if (e.glPatches) {
      for (const p of e.glPatches) { gl.texSubImage2D(gl.TEXTURE_2D, 0, p.x, p.y, p.w, p.h, gl.RGBA, gl.UNSIGNED_BYTE, p.data); this.stats.patchPx += p.w * p.h }
      e.glPatches = null
    }
    return T
  }
  /** 区块卸载 → 删纹理(ChunkStreamer.onEvict 里调) */
  freeChunk(e) { const T = this.chunks.get(e.key); if (T) { this.gl.deleteTexture(T.t); this.chunks.delete(e.key) } }
  static get UPLOADED() { return UPLOADED }

  /**
   * @param {object} p
   * @param {HTMLCanvasElement} p.top       顶层(世界分辨率,透明底:粒子 / 精灵 / 实体 / 人)
   * @param {Uint8Array} p.mat  VW×VH 材质 id  @param {Uint8Array} p.aux  VW×VH 燃烧标记(CellSim aux)
   * @param {Array<object|null>} p.chunks   视口覆盖的 2 列 × 3 行区块 entry,行优先 [C0 C1 / C2 C3 / C4 C5](没到的 null)
   * @param {number} p.corgX @param {number} p.corgY  左上那块的世界坐标
   * @param {ImageData} p.light             光图(Lighting.compose 的 img,1/4 分辨率)
   * @param {HTMLCanvasElement|null} p.sky  天空画布(相机深度 < 512 时才有);p.skyDirty = 这帧重画过
   * @param {boolean} p.liquid              视口里有液体才做折射采样
   * @param {number} p.vw @param {number} p.vh @param {number} p.ox @param {number} p.oy @param {number} p.time @param {number} p.camX @param {number} p.camY
   */
  render(p) {
    const gl = this.gl, U = this.UNIT
    this._up(U.top, this.texTop, p.top)
    this._up(U.light, this.texLight, p.light)
    if (p.sky && (p.skyDirty || this.texSky.w !== p.sky.width || this.texSky.h !== p.sky.height)) this._up(U.sky, this.texSky, p.sky)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    // 材质 id Uint16(小端)按字节看就是 (lo, hi) 对 → LUMINANCE_ALPHA
    this._upBytes(U.mat, this.texMat, new Uint8Array(p.mat.buffer, p.mat.byteOffset, p.mat.byteLength), p.vw, p.vh, gl.LUMINANCE_ALPHA)
    this._upBytes(U.aux, this.texAux, p.aux, p.vw, p.vh, gl.LUMINANCE)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    for (let i = 0; i < 6; i++) {
      gl.activeTexture(gl.TEXTURE0 + U.c0 + i)
      const e = p.chunks[i], T = e ? this.chunk(e) : null
      gl.bindTexture(gl.TEXTURE_2D, T ? T.t : this.texEmpty.t)
    }
    gl.uniform1f(this.u.uTime, p.time); gl.uniform2f(this.u.uCam, p.camX, p.camY); gl.uniform2f(this.u.uVP, p.vw, p.vh)
    gl.uniform2f(this.u.uOrg, p.ox, p.oy); gl.uniform2f(this.u.uCorg, p.corgX, p.corgY)
    gl.uniform1f(this.u.uSkyOn, p.sky ? 1 : 0); gl.uniform1f(this.u.uRefr, p.liquid ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}
