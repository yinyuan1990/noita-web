// ── 液体折射后处理(data/shaders/post_final.frag ENABLE_REFRACTION 那一段,原式照抄)──
// 原版:整张前景在屏幕分辨率下按液体格做采样偏移
//   liquid_distortion_offset = ( liquid_mask * sin(time*DISTORTION_TIME_SPD + (tex_coord.x + camera_pos.x/world_viewport_size.x) * DISTORTION_SCALE_MULT) * DISTORTION_SCALE_MULT2,
//                                liquid_mask * cos(time*DISTORTION_TIME_SPD + (tex_coord.y - camera_pos.y/world_viewport_size.y) * DISTORTION_SCALE_MULT) * DISTORTION_SCALE_MULT2 ) / camera_inv_zoom_ratio
//   DISTORTION_TIME_SPD 10 / SCALE_MULT 50 / SCALE_MULT2 0.002;采样到的那格也得是液体才偏(extra_data_at_liquid_offset)
// 偏移只有 0.85 世界像素,但是在屏幕分辨率(2~4.5 倍)下亚像素采样,翻转边界在屏幕像素间平滑移动 → 水里的东西看着在晃。
// 世界分辨率的 canvas 上做不出来(四舍五入只剩 0 / ±1 抖),所以放大那一步用 WebGL 做:输入 = 世界分辩率的画面 + 液体掩码,输出 = 屏幕分辨率的画面。
export class LiquidRefraction {
  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: false })
    this.gl = gl
    if (!gl) return
    const vs = `attribute vec2 a; varying vec2 v; void main(){ v = a * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(a, 0.0, 1.0); }`
    const fs = `precision mediump float; varying vec2 v; uniform sampler2D uView, uMask; uniform float uTime; uniform vec2 uCam, uVP;
      void main(){
        float m = step(0.5, texture2D(uMask, v).r);
        vec2 off = vec2( m * sin(uTime * 10.0 + (v.x + uCam.x / uVP.x) * 50.0) * 0.002,
                         m * cos(uTime * 10.0 + (v.y + uCam.y / uVP.y) * 50.0) * 0.002 );
        off *= step(0.5, texture2D(uMask, v + off).r);
        gl_FragColor = vec4(texture2D(uView, v + off).rgb, 1.0);
      }`
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh }
    const prog = gl.createProgram(); gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0)
    this.u = { time: gl.getUniformLocation(prog, 'uTime'), cam: gl.getUniformLocation(prog, 'uCam'), vp: gl.getUniformLocation(prog, 'uVP') }
    gl.uniform1i(gl.getUniformLocation(prog, 'uView'), 0); gl.uniform1i(gl.getUniformLocation(prog, 'uMask'), 1)
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t }
    this.texView = tex(); this.texMask = tex()
    this.ok = true
  }

  resize(sw, sh) {
    if (!this.ok) return
    this.canvas.width = sw; this.canvas.height = sh
    this.gl.viewport(0, 0, sw, sh)
  }

  /**
   * @param {HTMLCanvasElement} view  世界分辨率画面(已乘光照)
   * @param {Uint8Array} mask  VW×VH,液体格 255
   * @param {number} time 秒 @param {number} camX @param {number} camY 相机(世界坐标) @param {number} vw @param {number} vh
   */
  render(view, mask, vw, vh, time, camX, camY) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texView)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, view)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texMask)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, vw, vh, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask)
    gl.uniform1f(this.u.time, time); gl.uniform2f(this.u.cam, camX, camY); gl.uniform2f(this.u.vp, vw, vh)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }
}
