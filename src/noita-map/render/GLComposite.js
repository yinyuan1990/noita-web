// ── WebGL 最终合成(反 data/shaders/post_final.frag 的后半段):前景 × 光照 → 垫天空 / 黑底 → 液体折射 → 放大到屏幕,一次 draw ──
// 之前这几步全在 2D 画布上做:multiply 乘光图、destination-in 抠前景 alpha、destination-over 垫天空、fillRect 垫黑、再 drawImage 放大到屏幕
//(有液体时还要 texImage2D 读 2D 画布进 WebGL 折射、画完再 drawImage 回 2D)—— iPhone 上"乘光 + 天空" 2ms、"贴屏" 4~6ms,全是 CoreGraphics 在 CPU 上光栅整屏。
// 现在:世界分辨率的前景(view 画布)/ 1/4 分辨率的光图(Lighting.compose 的 ImageData)/ 天空画布 / 液体掩码 各上传一张纹理,shader 里按原来 2D 路径的合成公式算:
//   multiply(光, 前景premult) + destination-in(前景 alpha) + destination-over(天空 / 黑底)  ≡  a·L·(a·fg + 1 − a) + (1 − a)·bg
// 折射(ENABLE_REFRACTION 原式):液体格在屏幕分辨率下亚像素采样偏 0.85 世界像素,采样到的那格也得是液体才偏。
// 屏幕画布就是 WebGL 画布(#game),瞄准圈 / 指引箭头另画在 #ui 上。
export class GLComposite {
  /** @param {HTMLCanvasElement} canvas 屏幕画布 */
  constructor(canvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: false, depth: false, stencil: false })
    this.gl = gl
    if (!gl) return
    const vs = `attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(a, 0.0, 1.0); }`
    const fs = `precision mediump float; varying vec2 v;
      uniform sampler2D uFg, uLight, uSky, uMask; uniform float uTime, uSkyOn, uRefr; uniform vec2 uCam, uVP;
      void main(){
        float m = uRefr * step(0.5, texture2D(uMask, v).r);
        vec2 off = vec2( m * sin(uTime * 10.0 + (v.x + uCam.x / uVP.x) * 50.0) * 0.002,
                         m * cos(uTime * 10.0 + (v.y + uCam.y / uVP.y) * 50.0) * 0.002 );
        off *= step(0.5, texture2D(uMask, v + off).r);
        vec2 s = v + off;
        vec4 fg = texture2D(uFg, s);
        vec3 lt = texture2D(uLight, s).rgb;
        vec3 bg = vec3(6.0, 7.0, 10.0) / 255.0;
        if (uSkyOn > 0.5) { vec4 sk = texture2D(uSky, s); bg = mix(bg, sk.rgb, sk.a); }
        float a = fg.a;
        gl_FragColor = vec4(a * lt * (a * fg.rgb + (1.0 - a)) + (1.0 - a) * bg, 1.0);
      }`
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh }
    const prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    this.u = { time: gl.getUniformLocation(prog, 'uTime'), cam: gl.getUniformLocation(prog, 'uCam'), vp: gl.getUniformLocation(prog, 'uVP'), skyOn: gl.getUniformLocation(prog, 'uSkyOn'), refr: gl.getUniformLocation(prog, 'uRefr') }
    for (const [n, i] of [['uFg', 0], ['uLight', 1], ['uSky', 2], ['uMask', 3]]) gl.uniform1i(gl.getUniformLocation(prog, n), i)
    const tex = (filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return { t, w: 0, h: 0 } }
    // 光图 LINEAR:原 2D 路径 imageSmoothingEnabled=true 把 1/4 分辩率光图双线性拉到整屏;其余 NEAREST(像素画)
    this.texFg = tex(gl.NEAREST); this.texLight = tex(gl.LINEAR); this.texSky = tex(gl.NEAREST); this.texMask = tex(gl.NEAREST)
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

  /** 画布 / ImageData 上传:尺寸没变走 texSubImage2D(不重新分配) */
  _up(unit, T, src, fmt = this.gl.RGBA) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, T.t)
    if (T.w === src.width && T.h === src.height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fmt, gl.UNSIGNED_BYTE, src)
    else { gl.texImage2D(gl.TEXTURE_2D, 0, fmt, fmt, gl.UNSIGNED_BYTE, src); T.w = src.width; T.h = src.height }
  }

  /**
   * @param {object} p
   * @param {HTMLCanvasElement} p.view      世界分辨率前景(未乘光,透明处 = 没东西)
   * @param {ImageData} p.light            光图(Lighting.compose 的 img,1/4 分辨率)
   * @param {HTMLCanvasElement|null} p.sky 天空画布(相机深度 < 512 时才有)
   * @param {Uint8Array} p.mask            VW×VH 液体掩码(255 = 液体);p.liquid = 视口里有液体才做折射采样
   * @param {number} p.vw @param {number} p.vh @param {number} p.time @param {number} p.camX @param {number} p.camY
   * @param {boolean} p.skyDirty  天空画布这帧重画过(没变就不重传)
   */
  render(p) {
    const gl = this.gl
    this._up(0, this.texFg, p.view)
    this._up(1, this.texLight, p.light)
    if (p.sky && (p.skyDirty || this.texSky.w !== p.sky.width || this.texSky.h !== p.sky.height)) this._up(2, this.texSky, p.sky)
    if (p.liquid) {
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texMask.t)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      if (this.texMask.w === p.vw && this.texMask.h === p.vh) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, p.vw, p.vh, gl.LUMINANCE, gl.UNSIGNED_BYTE, p.mask)
      else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, p.vw, p.vh, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, p.mask); this.texMask.w = p.vw; this.texMask.h = p.vh }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    }
    gl.uniform1f(this.u.time, p.time); gl.uniform2f(this.u.cam, p.camX, p.camY); gl.uniform2f(this.u.vp, p.vw, p.vh)
    gl.uniform1f(this.u.skyOn, p.sky ? 1 : 0); gl.uniform1f(this.u.refr, p.liquid ? 1 : 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}
