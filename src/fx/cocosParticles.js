import * as PIXI from 'pixi.js'

/**
 * Cocos2d 粒子系统移植（plist 驱动）
 * 来源：D:\cs\kuanzi\cocosgodot（cocos2d-iphone 粒子 demo）
 *
 * - loadCocosParticle(url)        解析 .plist → { config, texture }
 * - CocosEmitter                  单发射器（gravity / radius 两种模式 + 自定义曲线）
 * - playCocosEffect(parent, name) 播放组合特效，返回 Promise（粒子放完自动清理）
 * - COCOS_EFFECTS                 全部可用特效名
 *
 * 组合特效还原自 CCParticleEffectGenerator.m；
 * 曲线（大小/速度/透明度随生命周期变化）还原自 CCParticleFlare.m / CCParticleGlow.m。
 */

import { loadCocosConfig } from './cocosPlist.js'

const BASE = (import.meta.env.BASE_URL || '/') + 'res/cocos-particles' // 子路径部署：加 Vite base 前缀
const DEG = Math.PI / 180

/* ---------------------------------- 贴图 ---------------------------------- */

const _plistCache = new Map()
const _texCache = new Map()

/** 兜底贴图：程序生成的柔光圆斑 */
let _fallbackTex = null
function fallbackTexture() {
  if (_fallbackTex) return _fallbackTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  _fallbackTex = PIXI.Texture.from(c)
  return _fallbackTex
}

function loadTextureFile(url) {
  if (_texCache.has(url)) return _texCache.get(url)
  // 自己解码 HTMLImageElement 再交给 PIXI：坏图直接 resolve(null) 走兜底，
  // 避免 PIXI.Texture.from(url) 内部 promise 在解码失败时产生无人接住的 rejection
  const p = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(PIXI.Texture.from(img))
    img.onerror = () => resolve(null)
    img.src = url
  })
  _texCache.set(url, p)
  return p
}

/**
 * 加载一份 cocos 粒子 plist
 * @returns {Promise<{config, texture}>}
 */
export async function loadCocosParticle(url) {
  if (_plistCache.has(url)) return _plistCache.get(url)
  const p = (async () => {
    const { config, textureUrl } = await loadCocosConfig(url)
    let texture = textureUrl ? await loadTextureFile(textureUrl) : null
    if (!texture) texture = fallbackTexture()
    return { config, texture }
  })()
  _plistCache.set(url, p)
  return p
}

/* ------------------------------ 自定义曲线（.m 移植） ------------------------------ */

// CC_LINEAR(a, b, t) = a*t + b，t 为归一化生命进度
const LIN = (a, b, t) => a * t + b
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 每个 modifier 对应 .m 里的一个 CCParticleXxx 子类：
 * - scaleWH: 宽高独立缩放（start/end + Var）
 * - size(p,t) / speed(p,t) / alpha(p,t): 覆盖默认插值
 */
export const COCOS_MODIFIERS = {
  implodingFlare: {
    scaleWH: { hStart: 1.5, hStartVar: 1.0, hEnd: 2.5 },
    speed: (p, t) => LIN(-10, 150, t),
    alpha: (p, t) => clamp01(t < 0.5 ? 2 * t : 2 - 2 * t),
  },
  chaoticFlare: {
    scaleWH: { hStart: 2.0, hStartVar: 0.5, hEnd: 1.2, wStart: 0.5, wEnd: 0.3 },
  },
  candleFlare: {
    size: (p, t) => p.orgSize * Math.max(0, LIN(-1, 1.2, t)),
    alpha: (p, t) => (t <= 0.1 ? clamp01(t / 0.1) : 1),
    speed: (p, t) => p.orgSpeed * (t <= 0.03 ? LIN(-11, 0.45, t) : Math.max(0, LIN(-0.12, 0.12, t))),
  },
  pangFlare: {
    scaleWH: { wStart: 0.0, wStartVar: 0.5, wEnd: 1.2, hStart: 1.0, hEnd: 1.2 },
  },
  growingFlare: {
    size: (p, t) => p.orgSize * (t <= 0.4 ? LIN(1, 0, t) : LIN(0.67, 0.13, t)),
    speed: (p, t) => p.orgSpeed * (t <= 0.23 ? LIN(-7.8, 2.2, t) : Math.max(0, LIN(-0.5, 0.5, t))),
  },
  sparkFlare: {
    scaleWH: { wStart: 0.5, wEnd: 0.5 },
    size: (p, t) => p.orgSize * LIN(1, 0, t),
    speed: (p, t) => p.orgSpeed * LIN(-0.4, 1, t),
  },
  starGlow: {
    size: (p, t) => (t <= 0.6 ? p.orgSize * LIN(1, 0.8, t) : p.size),
    alpha: (p, t) => clamp01(t <= 0.03 ? LIN(3, 0, t) : LIN(-0.9, 0.9, t)),
  },
  fadeGlow: {
    size: (p, t) => (t > 0.5 ? p.orgSize * LIN(-1, 2, t) : p.size),
  },
  flatGlow: {
    // 原版水平光束宽度峰值达贴图 26 倍（size 200 → ~5200px），在本游戏画布里会横贯 2~3 屏、
    // 与火球主体比例失衡；这里把宽度曲线整体压到约 1/2.6，光束长度收敛到 ~1 屏、更协调
    scale: (p, t) => ({
      h: t <= 0.5 ? 0.24 : Math.max(0, LIN(-0.48, 0.48, t)),
      w: t <= 0.8 ? LIN(6.25, 0, t) : LIN(25, -15, t),
    }),
  },
  implodingGlow: {
    size: (p, t) => p.orgSize * (t <= 0.9 ? LIN(2.25, 0, t) : Math.max(0, LIN(-4, 4, t))),
    alpha: (p, t) => (t <= 0.5 ? 0.2 : clamp01(LIN(2, -1, t))),
  },
  blastWave: {
    size: (p, t) => p.orgSize * LIN(1, 0, t),
  },
}

/* ---------------------------------- 发射器 ---------------------------------- */

const rand1 = () => Math.random() * 2 - 1 // CCRANDOM_MINUS1_1

/**
 * 单发射器。用法：
 *   const { config, texture } = await loadCocosParticle(url)
 *   const em = new CocosEmitter(config, texture, { modifier: COCOS_MODIFIERS.sparkFlare })
 *   parent.addChild(em); em.x = ...; em.y = ...
 * 默认 autoRemove：duration 结束 + 粒子放完后自毁。
 */
export class CocosEmitter extends PIXI.Container {
  /**
   * @param {object} config   normalizeConfig 的输出
   * @param {PIXI.Texture} texture
   * @param {object} [opts]  { modifier, overrides, autoRemove=true, onComplete }
   */
  constructor(config, texture, opts = {}) {
    super()
    this.cfg = { ...config, ...(opts.overrides || {}) }
    this.texture = texture
    this.modifier = opts.modifier || null
    this.autoRemove = opts.autoRemove !== false
    this.onComplete = opts.onComplete || null

    this._pool = []
    this._live = []
    this._elapsed = 0
    this._emitAcc = 0
    this._running = true
    this._done = false
    // 发射速率：cocos 默认 total / lifespan
    this._rate = this.cfg.emissionRate || this.cfg.maxParticles / this.cfg.lifespan

    this._tick = () => {
      this.update(PIXI.Ticker.shared.deltaMS / 1000)
    }
    PIXI.Ticker.shared.add(this._tick)
  }

  stop() {
    this._running = false
  }

  _spawn() {
    const c = this.cfg
    const p = this._pool.pop() || { spr: new PIXI.Sprite(this.texture) }
    const spr = p.spr
    spr.texture = this.texture
    spr.anchor.set(0.5)
    spr.blendMode = c.additive ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL
    spr.visible = true
    this.addChild(spr)

    p.life = Math.max(0.05, c.lifespan + c.lifespanVar * rand1())
    p.elapsed = 0

    // 颜色
    const sc = c.startColor, scv = c.startColorVar, ec = c.endColor, ecv = c.endColorVar
    p.r = clamp01(sc[0] + scv[0] * rand1()); p.g = clamp01(sc[1] + scv[1] * rand1())
    p.b = clamp01(sc[2] + scv[2] * rand1()); p.a = clamp01(sc[3] + scv[3] * rand1())
    const er = clamp01(ec[0] + ecv[0] * rand1()), eg = clamp01(ec[1] + ecv[1] * rand1())
    const eb = clamp01(ec[2] + ecv[2] * rand1()), ea = clamp01(ec[3] + ecv[3] * rand1())
    p.dr = (er - p.r) / p.life; p.dg = (eg - p.g) / p.life
    p.db = (eb - p.b) / p.life; p.da = (ea - p.a) / p.life

    // 大小（cocos 单位 = 像素）
    p.size = Math.max(0, c.startSize + c.startSizeVar * rand1())
    p.orgSize = p.size
    const endSize = Math.max(0, c.endSize + c.endSizeVar * rand1())
    p.dsize = (endSize - p.size) / p.life

    // 旋转
    p.rot = c.rotationStart + c.rotationStartVar * rand1()
    const rotEnd = c.rotationEnd + c.rotationEndVar * rand1()
    p.drot = (rotEnd - p.rot) / p.life

    // 宽高独立缩放（.m 扩展）
    const wh = this.modifier?.scaleWH
    if (wh) {
      p.wScale = (wh.wStart ?? 1) + (wh.wStartVar ?? 0) * rand1()
      p.hScale = (wh.hStart ?? 1) + (wh.hStartVar ?? 0) * rand1()
      p.dwScale = ((wh.wEnd ?? p.wScale) - p.wScale) / p.life
      p.dhScale = ((wh.hEnd ?? p.hScale) - p.hScale) / p.life
    } else {
      p.wScale = p.hScale = 1
      p.dwScale = p.dhScale = 0
    }

    const a = -(c.angle + c.angleVar * rand1()) * DEG // cocos y 朝上 → pixi 取负
    if (c.emitterMode === 'radius') {
      p.angle = a
      p.radius = c.startRadius + c.startRadiusVar * rand1()
      const endR = c.endRadius + (c.endRadiusVar || 0) * rand1()
      p.dradius = (endR - p.radius) / p.life
      p.degPerSec = -(c.rotatePerSecond + c.rotatePerSecondVar * rand1()) * DEG
      p.x = Math.cos(p.angle) * p.radius
      p.y = Math.sin(p.angle) * p.radius
    } else {
      p.x = c.posVarX * rand1()
      p.y = c.posVarY * rand1()
      p.dirX = Math.cos(a)
      p.dirY = Math.sin(a)
      p.orgSpeed = c.speed + c.speedVar * rand1()
      p.vx = p.dirX * p.orgSpeed
      p.vy = p.dirY * p.orgSpeed
      p.radialAccel = c.radialAccel + c.radialAccelVar * rand1()
      p.tangentialAccel = c.tangentialAccel + c.tangentialAccelVar * rand1()
    }
    this._live.push(p)
    this._applyVisual(p, 0)
  }

  _applyVisual(p, t) {
    const spr = p.spr
    const mod = this.modifier
    let size = mod?.size ? mod.size(p, t) : p.size
    let w = p.wScale
    let h = p.hScale
    if (mod?.scale) {
      const s = mod.scale(p, t)
      w = s.w
      h = s.h
    }
    const texW = this.texture.width || 1
    const texH = this.texture.height || 1
    spr.scale.set((size / texW) * w, (size / texH) * h)
    // alignToDir（cocos rotationIsDir）：贴图长轴朝向飞行方向（gravity 模式），长条光痕类粒子用
    // 光痕贴图长轴为竖直方向，故在 atan2 上补 90°
    spr.rotation = this.cfg.alignToDir && this.cfg.emitterMode !== 'radius'
      ? Math.atan2(p.vy, p.vx) + Math.PI / 2
      : -p.rot * DEG
    spr.alpha = mod?.alpha ? mod.alpha(p, t) : clamp01(p.a)
    // 颜色 → tint
    const ri = (clamp01(p.r) * 255) | 0
    const gi = (clamp01(p.g) * 255) | 0
    const bi = (clamp01(p.b) * 255) | 0
    spr.tint = (ri << 16) | (gi << 8) | bi
    spr.x = p.x
    spr.y = p.y
  }

  update(dt) {
    if (this._done) return
    const c = this.cfg

    // 发射
    if (this._running) {
      this._elapsed += dt
      if (c.duration < 0 || this._elapsed < c.duration) {
        this._emitAcc += this._rate * dt
        while (this._emitAcc >= 1 && this._live.length < c.maxParticles) {
          this._emitAcc -= 1
          this._spawn()
        }
      } else {
        this._running = false
      }
    }

    // 更新
    for (let i = this._live.length - 1; i >= 0; i--) {
      const p = this._live[i]
      p.elapsed += dt
      if (p.elapsed >= p.life) {
        p.spr.visible = false
        this.removeChild(p.spr)
        this._live.splice(i, 1)
        this._pool.push(p)
        continue
      }
      const t = p.elapsed / p.life

      if (c.emitterMode === 'radius') {
        p.angle += p.degPerSec * dt
        p.radius += p.dradius * dt
        p.x = Math.cos(p.angle) * p.radius
        p.y = Math.sin(p.angle) * p.radius
      } else {
        const mod = this.modifier
        if (mod?.speed) {
          const s = mod.speed(p, t)
          p.vx = p.dirX * s
          p.vy = p.dirY * s
        } else if (p.radialAccel || p.tangentialAccel || c.gravityX || c.gravityY) {
          let rx = 0, ry = 0
          const len = Math.hypot(p.x, p.y)
          if (len > 1e-6) {
            rx = p.x / len
            ry = p.y / len
          }
          const tx = -ry, ty = rx
          p.vx += (rx * p.radialAccel + tx * p.tangentialAccel + c.gravityX) * dt
          p.vy += (ry * p.radialAccel + ty * p.tangentialAccel - c.gravityY) * dt
        }
        p.x += p.vx * dt
        p.y += p.vy * dt
      }

      p.size += p.dsize * dt
      p.rot += p.drot * dt
      p.r += p.dr * dt; p.g += p.dg * dt; p.b += p.db * dt; p.a += p.da * dt
      p.wScale += p.dwScale * dt
      p.hScale += p.dhScale * dt
      this._applyVisual(p, t)
    }

    // 结束
    if (!this._running && this._live.length === 0) {
      this._done = true
      PIXI.Ticker.shared.remove(this._tick)
      const cb = this.onComplete
      if (this.autoRemove) {
        if (this.parent) this.parent.removeChild(this)
        this.destroy({ children: true })
      }
      if (cb) cb()
    }
  }

  destroy(opts) {
    PIXI.Ticker.shared.remove(this._tick)
    this._done = true
    super.destroy(opts)
  }
}

/* ------------------------------ 组合特效（Generator 移植） ------------------------------ */

const SRC = {
  burningFlare: `${BASE}/flare/burningFlare.plist`,
  burstFlare: `${BASE}/flare/burstFlare.plist`,
  implodingFlare: `${BASE}/flare/implodingFlare.plist`,
  chaoticFlare: `${BASE}/flare/chaoticFlare.plist`,
  candleFlare: `${BASE}/flare/candleFlare.plist`,
  pangFlare: `${BASE}/flare/pangFlare.plist`,
  growingFlare: `${BASE}/flare/growingFlare.plist`,
  sparkFlare: `${BASE}/flare/sparkFlare.plist`,
  circleGlow: `${BASE}/glow/circleGlow.plist`,
  starGlow: `${BASE}/glow/starGlow.plist`,
  fadeGlow: `${BASE}/glow/fadeGlow.plist`,
  flatGlow: `${BASE}/glow/flatGlow.plist`,
  implodingGlow: `${BASE}/glow/implodingGlow.plist`,
  blastWave: `${BASE}/glow/blastWave.plist`,
  dustFlare: `${BASE}/dust/dustFlare.plist`,
  dustBurst: `${BASE}/dust/dustBurst.plist`,
  dustRise: `${BASE}/dust/dustRise.plist`,
  armCloud: `${BASE}/smoke/armCloud.plist`,
  toonCloud: `${BASE}/smoke/toonCloud.plist`,
}

const rgba = (r, g, b, a) => ({ startColor: [r, g, b, a], startColorVar: [0, 0, 0, 0] })
const rand = (a, b) => a + Math.random() * (b - a)

/**
 * 特效定义：每层 { src, mod?, overrides?, node?{x,y,scaleX,scaleY,rotation} }
 * 名称与 CCParticleEffectGenerator 一一对应，另加 canBlast（HelloWorldScene 点击爆炸）。
 */
export const COCOS_EFFECTS = {
  // 单发射器
  flare: () => [{ src: 'burningFlare' }],
  chaoticFlare: () => [{ src: 'chaoticFlare', mod: 'chaoticFlare' }],
  candleFlare: () => [{ src: 'candleFlare', mod: 'candleFlare' }],
  growingFlare: () => [{ src: 'growingFlare', mod: 'growingFlare' }],
  sparkFlare: () => [{ src: 'sparkFlare', mod: 'sparkFlare' }],
  blastWave: () => [{ src: 'blastWave', mod: 'blastWave' }],
  dustRise: () => [{ src: 'dustRise' }],

  // 多发射器（Generator）
  burstFlare: () => [
    { src: 'implodingFlare', mod: 'implodingFlare' },
    { src: 'burstFlare' },
  ],
  groundExplode: () => [
    { src: 'dustFlare' },
    { src: 'dustFlare', overrides: { ...rgba(1, 0.5, 0.3, 1), endColor: [1, 0.5, 0.3, 0] } },
    { src: 'dustBurst' },
    { src: 'dustRise' },
  ],
  armExplode: () => [
    { src: 'toonCloud' },
    { src: 'armCloud' },
    { src: 'pangFlare', mod: 'pangFlare' },
  ],
  cartoonExplode: () => [
    { src: 'candleFlare', mod: 'candleFlare' },
    { src: 'toonCloud', overrides: { ...rgba(1, 0.5, 0.3, 1), endColor: [0.8, 0.3, 0.1, 0.5] } },
  ],
  areaBang: () => [
    { src: 'blastWave', mod: 'blastWave' },
    { src: 'growingFlare', mod: 'growingFlare' },
    { src: 'sparkFlare', mod: 'sparkFlare' },
  ],
  // areaBang 变体：光痕按各自飞行方向放射（原版光痕贴图恒为水平角度，放大后会连成横贯屏幕的直线）
  nukeBlast: () => [
    { src: 'blastWave', mod: 'blastWave' },
    { src: 'growingFlare', mod: 'growingFlare' },
    { src: 'sparkFlare', mod: 'sparkFlare', overrides: { alignToDir: true } },
  ],
  bigBang: () => [
    { src: 'circleGlow' },
    { src: 'starGlow', mod: 'starGlow', overrides: { startSize: 300 } },
    { src: 'flatGlow', mod: 'flatGlow' },
    { src: 'implodingGlow', mod: 'implodingGlow' },
  ],

  // HelloWorldScene 里点击罐子的爆炸（5 组随机环 + 闪光条 + 冲击波）
  canBlast: () => {
    const layers = []
    for (let i = 0; i < 5; i++) {
      layers.push({
        src: 'growingFlare',
        mod: 'growingFlare',
        overrides: {
          maxParticles: 20,
          endSize: 1,
          lifespan: 1.3,
          emitterMode: 'radius',
          startRadius: 30, startRadiusVar: 10,
          endRadius: 60, endRadiusVar: 30,
          emissionRate: 20 / 1.3,
        },
        node: { scale: rand(1, 2.5) },
      })
      layers.push({
        src: 'sparkFlare',
        mod: 'sparkFlare',
        overrides: {
          maxParticles: 1,
          emitterMode: 'radius',
          startRadius: 100, startRadiusVar: 0,
          endRadius: 100, endRadiusVar: 0,
        },
        node: { rotation: Math.random() * Math.PI * 2, scaleX: rand(0, 0.4), scaleY: rand(1, 2.5) },
      })
      layers.push({
        src: 'blastWave',
        mod: 'blastWave',
        overrides: {
          maxParticles: 2,
          startSize: 500, startSizeVar: 100,
          endSize: 500,
          duration: 0.3,
          emissionRate: 2 / 0.3,
        },
      })
    }
    return layers
  },
}

/**
 * 播放一个组合特效
 * @param {PIXI.Container} parent
 * @param {string} name COCOS_EFFECTS 键名
 * @param {object} [opts] { x=0, y=0, scale=1 }
 * @returns {Promise<PIXI.Container|null>} 全部粒子放完后 resolve
 */
export async function playCocosEffect(parent, name, opts = {}) {
  const def = COCOS_EFFECTS[name]
  if (!def) {
    console.warn('[cocosFx] unknown effect', name)
    return null
  }
  const layers = def()
  const loaded = await Promise.all(
    layers.map((l) => loadCocosParticle(SRC[l.src]).catch((e) => {
      console.warn('[cocosFx] load fail', l.src, e)
      return null
    }))
  )

  const group = new PIXI.Container()
  group.x = opts.x || 0
  group.y = opts.y || 0
  if (opts.scale) group.scale.set(opts.scale)
  parent.addChild(group)

  let pending = 0
  await new Promise((resolve) => {
    layers.forEach((l, i) => {
      const res = loaded[i]
      if (!res) return
      pending++
      const em = new CocosEmitter(res.config, res.texture, {
        modifier: l.mod ? COCOS_MODIFIERS[l.mod] : null,
        overrides: l.overrides,
        onComplete: () => {
          if (--pending === 0) resolve()
        },
      })
      const n = l.node
      if (n) {
        if (n.rotation != null) em.rotation = n.rotation
        if (n.scale != null) em.scale.set(n.scale)
        if (n.scaleX != null) em.scale.x = n.scaleX
        if (n.scaleY != null) em.scale.y = n.scaleY
        if (n.x) em.x = n.x
        if (n.y) em.y = n.y
      }
      group.addChild(em)
    })
    if (pending === 0) resolve()
  })

  if (group.parent) group.parent.removeChild(group)
  group.destroy({ children: true })
  return group
}

export function listCocosEffects() {
  return Object.keys(COCOS_EFFECTS)
}
