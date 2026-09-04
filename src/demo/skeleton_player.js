// 战机/挂载 骨骼动画渲染运行时（CocoStudio + DragonBones）
// 资源图集已用 TEA 解密并内嵌在 skeleton_models.json 里，这里只负责渲染。
// 用法见 飞机升级系统对接文档.md 的「骨骼动画对接」章节。
//
// const player = new SkeletonPlayer(modelData, { width:480, height:600, fps:30 })
// await player.load()
// player.setAnimation('BaoZou')
// 每帧: player.render(performance.now()/1000); 然后用 player.canvas 作为贴图/绘制源

function lerp(a, b, t) { return a + (b - a) * t }
function matMul(P, l) { return [P[0] * l[0] + P[2] * l[1], P[1] * l[0] + P[3] * l[1], P[0] * l[2] + P[2] * l[3], P[1] * l[2] + P[3] * l[3], P[0] * l[4] + P[2] * l[5] + P[4], P[1] * l[4] + P[3] * l[5] + P[5]] }
// CocoStudio 仿射(y-up)
function csMat(x, y, sx, sy, skx, sky) { return [Math.cos(sky) * sx, Math.sin(sky) * sx, -Math.sin(skx) * sy, Math.cos(skx) * sy, x, y] }
// DragonBones 仿射(y-down, 角度制)
function dbMat(t) { const skX = (t.skX || 0) * Math.PI / 180, skY = (t.skY || 0) * Math.PI / 180, scX = t.scX == null ? 1 : t.scX, scY = t.scY == null ? 1 : t.scY; return [Math.cos(skY) * scX, Math.sin(skY) * scX, -Math.sin(skX) * scY, Math.cos(skX) * scY, t.x || 0, t.y || 0] }

function sampleCS(track, t) { if (!track || !track.length) return null; if (t <= track[0].fi) return track[0]; if (t >= track[track.length - 1].fi) return track[track.length - 1]; for (let i = 0; i < track.length - 1; i++) { const A = track[i], B = track[i + 1]; if (t >= A.fi && t <= B.fi) { const u = (B.fi - A.fi) ? (t - A.fi) / (B.fi - A.fi) : 0; return { x: lerp(A.x, B.x, u), y: lerp(A.y, B.y, u), cX: lerp(A.cX, B.cX, u), cY: lerp(A.cY, B.cY, u), kX: lerp(A.kX, B.kX, u), kY: lerp(A.kY, B.kY, u), a: lerp(A.a, B.a, u) } } } return track[track.length - 1] }
function stepFrame(track, t) { if (!track || !track.length) return null; let f = track[0]; for (const k of track) { if (k.fi <= t) f = k; else break } return f }
function trackAt(frames, t) { if (!frames || !frames.length) return null; let acc = 0; for (let i = 0; i < frames.length; i++) { const f = frames[i]; const dur = f.d; if (dur <= 0) return { a: f, b: f, u: 0 }; if (t < acc + dur || i === frames.length - 1) { const nf = frames[i + 1] || f; let u = dur > 0 ? (t - acc) / dur : 0; if (f.tw == null) u = 0; return { a: f, b: nf, u: Math.max(0, Math.min(1, u)) } } acc += dur } return { a: frames[frames.length - 1], b: frames[frames.length - 1], u: 0 } }
function boneAnimT(seg) { if (!seg) return { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 }; const a = seg.a.t, b = seg.b.t, u = seg.u; return { x: lerp(a.x || 0, b.x || 0, u), y: lerp(a.y || 0, b.y || 0, u), skX: lerp(a.skX || 0, b.skX || 0, u), skY: lerp(a.skY || 0, b.skY || 0, u), scX: lerp(a.scX == null ? 1 : a.scX, b.scX == null ? 1 : b.scX, u), scY: lerp(a.scY == null ? 1 : a.scY, b.scY == null ? 1 : b.scY, u) } }
function drawTri(ctx, im, sx0, sy0, sx1, sy1, sx2, sy2, dx0, dy0, dx1, dy1, dx2, dy2) { ctx.save(); ctx.beginPath(); ctx.moveTo(dx0, dy0); ctx.lineTo(dx1, dy1); ctx.lineTo(dx2, dy2); ctx.closePath(); ctx.clip(); const denom = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0; if (Math.abs(denom) < 1e-6) { ctx.restore(); return } const m11 = -(sy0 * (dx2 - dx1) - sy1 * dx2 + sy2 * dx1 + (sy1 - sy2) * dx0) / denom; const m12 = (sy1 * dy2 + sy0 * (dy1 - dy2) - sy2 * dy1 + (sy2 - sy1) * dy0) / denom; const m21 = (sx0 * (dx2 - dx1) - sx1 * dx2 + sx2 * dx1 + (sx1 - sx2) * dx0) / denom; const m22 = -(sx1 * dy2 + sx0 * (dy1 - dy2) - sx2 * dy1 + (sx2 - sx1) * dy0) / denom; const dx = (sx0 * (sy2 * dx1 - sy1 * dx2) + sy0 * (sx1 * dx2 - sx2 * dx1) + (sx2 * sy1 - sx1 * sy2) * dx0) / denom; const dy = (sx0 * (sy2 * dy1 - sy1 * dy2) + sy0 * (sx1 * dy2 - sx2 * dy1) + (sx2 * sy1 - sx1 * sy2) * dy0) / denom; ctx.transform(m11, m12, m21, m22, dx, dy); ctx.drawImage(im, 0, 0); ctx.restore() }

export class SkeletonPlayer {
  constructor(model, opt = {}) {
    this.m = model
    this.width = opt.width || 480
    this.height = opt.height || 600
    this.fps = opt.fps || 30
    this.scale = opt.scale || 1.0
    this.bloom = opt.bloom !== false
    this.anim = null
    this.canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null
    if (this.canvas) { this.canvas.width = this.width; this.canvas.height = this.height }
    this._buf = null; this._img = null; this.BASE = [1, 0, 0, 1, 0, 0]
    const names = Object.keys(model.anims)
    this.anim = names.includes('putong') ? 'putong' : (names.includes('Normal') ? 'Normal' : names[0])
  }
  animations() { return Object.keys(this.m.anims) }
  setAnimation(n) { if (this.m.anims[n]) this.anim = n }
  setScale(s) { this.scale = s }
  setBloom(b) { this.bloom = b }
  load() { return new Promise((res, rej) => { if (this._img) return res(this._img); const im = new Image(); im.onload = () => { this._img = im; res(im) }; im.onerror = rej; im.src = this.m.atlas }) }
  _setT(ctx, M) { const C = matMul(this.BASE, M); ctx.setTransform(C[0], C[1], C[2], C[3], C[4], C[5]) }

  _drawCS(ctx, im, t, CX, CY) {
    const m = this.m, anim = m.anims[this.anim]; const dur = Math.max(1, anim.dr); t = anim.lp ? (t % dur) : Math.min(t, dur)
    const world = {}
    const solveW = (name) => { if (world[name]) return world[name]; const b = m.bones[name]; if (!b) return [1, 0, 0, 1, 0, 0]; const tk = anim.tracks[name]; const tr = (tk && tk.length) ? sampleCS(tk, t) : { x: 0, y: 0, cX: 1, cY: 1, kX: 0, kY: 0 }; const local = csMat(b.x + tr.x, b.y + tr.y, b.cX * tr.cX, b.cY * tr.cY, b.kX + tr.kX, b.kY + tr.kY); const w = (b.parent && m.bones[b.parent]) ? matMul(solveW(b.parent), local) : local; world[name] = w; return w }
    for (const name of m.drawOrder) { const b = m.bones[name]; const track = anim.tracks[name]; let tr, di, bd; if (track && track.length) { tr = sampleCS(track, t); const sf = stepFrame(track, t); di = sf.di; bd = sf.bd } else { tr = { x: 0, y: 0, cX: 1, cY: 1, kX: 0, kY: 0, a: 255 }; di = 0; bd = 771 }
      if (di < 0) continue; const disp = b.displays[Math.min(Math.max(di, 0), b.displays.length - 1)] || b.displays[0]; if (!disp) continue; const fr = m.frames[disp.name]; if (!fr) continue
      const sk = disp.skin || {}; const skM = csMat(sk.x || 0, sk.y || 0, sk.cX == null ? 1 : sk.cX, sk.cY == null ? 1 : sk.cY, sk.kX || 0, sk.kY || 0)
      const mm = matMul(solveW(name), skM); const w = fr.w, h = fr.h
      const E = CX + mm[0] * (-w / 2) + mm[2] * (h / 2) + mm[4]; const F = CY - (mm[1] * (-w / 2) + mm[3] * (h / 2) + mm[5])
      ctx.globalAlpha = Math.max(0, Math.min(1, (tr.a == null ? 255 : tr.a) / 255)); ctx.globalCompositeOperation = (bd === 1) ? 'lighter' : 'source-over'
      this._setT(ctx, [mm[0], -mm[1], -mm[2], mm[3], E, F]); ctx.drawImage(im, fr.x, fr.y, w, h, 0, 0, w, h)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
  }

  _drawDB(ctx, im, t, CX, CY) {
    const m = this.m, anim = m.anims[this.anim]; const dur = Math.max(1, anim.dur); const loop = (anim.pt === 0); t = loop ? (t % dur) : Math.min(t, dur)
    const bmap = {}; for (const b of m.bones) bmap[b.name] = b; const world = {}
    const solve = (bn) => { if (world[bn]) return world[bn]; const b = bmap[bn]; if (!b) return [1, 0, 0, 1, 0, 0]; const at = boneAnimT(trackAt(anim.bone[bn], t)); const base = b.t; const comb = { x: (base.x || 0) + at.x, y: (base.y || 0) + at.y, skX: (base.skX || 0) + at.skX, skY: (base.skY || 0) + at.skY, scX: (base.scX == null ? 1 : base.scX) * at.scX, scY: (base.scY == null ? 1 : base.scY) * at.scY }; const l = dbMat(comb); const w = (b.parent && bmap[b.parent]) ? matMul(solve(b.parent), l) : l; world[bn] = w; return w }
    for (const b of m.bones) solve(b.name)
    const root = [1, 0, 0, 1, CX, CY]
    for (const sl of m.slots) { let di = sl.di, alpha = 1; const st = anim.slot[sl.name]; if (st) { const seg = trackAt(st, t); if (seg) { if (seg.a.di != null) di = seg.a.di; alpha = seg.a.a == null ? 1 : seg.a.a } }
      if (di < 0) continue; const disps = m.skin[sl.name]; if (!disps || di >= disps.length) continue; const dp = disps[di]
      const bw = world[sl.parent] || [1, 0, 0, 1, 0, 0]; const W = matMul(root, matMul(bw, dbMat(dp.t))); const s = m.sub[dp.path]; if (!s) continue
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha)); ctx.globalCompositeOperation = (sl.blend === 'add') ? 'lighter' : 'source-over'
      if (dp.type === 'mesh' && dp.triangles && dp.vertices) { const V = dp.vertices, U = dp.uvs, T = dp.triangles; const P = []; for (let i = 0; i < V.length; i += 2) P.push([W[0] * V[i] + W[2] * V[i + 1] + W[4], W[1] * V[i] + W[3] * V[i + 1] + W[5]]); const UV = []; for (let i = 0; i < U.length; i += 2) UV.push([s.x + U[i] * s.w, s.y + U[i + 1] * s.h]); this._setT(ctx, [1, 0, 0, 1, 0, 0]); for (let i = 0; i < T.length; i += 3) { const a = T[i], b = T[i + 1], c = T[i + 2]; drawTri(ctx, im, UV[a][0], UV[a][1], UV[b][0], UV[b][1], UV[c][0], UV[c][1], P[a][0], P[a][1], P[b][0], P[b][1], P[c][0], P[c][1]) } }
      else { const lx = -s.fw / 2 - s.fx, ly = -s.fh / 2 - s.fy; this._setT(ctx, [W[0], W[1], W[2], W[3], W[0] * lx + W[2] * ly + W[4], W[1] * lx + W[3] * ly + W[5]]); ctx.drawImage(im, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h) }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
  }

  // 把当前动画在 timeSec 时刻渲染到 this.canvas（含柔和辉光）
  render(timeSec) {
    if (!this._img || !this.canvas) return
    const cv = this.canvas, ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height)
    if (!this._buf) { this._buf = document.createElement('canvas'); this._buf.width = cv.width; this._buf.height = cv.height }
    const bctx = this._buf.getContext('2d'); bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, this._buf.width, this._buf.height)
    const cx = cv.width / 2, cy = cv.height * 0.5; this.BASE = [this.scale, 0, 0, this.scale, cx - this.scale * cx, cy - this.scale * cy]
    const t = timeSec * this.fps
    if (this.m.type === 'cs') this._drawCS(bctx, this._img, t, cv.width / 2, cv.height * 0.55)
    else this._drawDB(bctx, this._img, t, cv.width / 2, cv.height * 0.5)
    bctx.setTransform(1, 0, 0, 1, 0, 0)
    if (this.bloom) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4; ctx.filter = 'blur(4px)'; ctx.drawImage(this._buf, 0, 0); ctx.filter = 'none'; ctx.restore() }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.drawImage(this._buf, 0, 0)
  }
}

if (typeof window !== 'undefined') window.SkeletonPlayer = SkeletonPlayer
export default SkeletonPlayer
