import * as THREE from 'three'
import {
  BatchedRenderer,
  ParticleSystem,
  RenderMode,
  ConstantValue,
  IntervalValue,
  PiecewiseBezier,
  Bezier,
  ConstantColor,
  Gradient,
  ColorOverLife,
  SizeOverLife,
  SpeedOverLife,
  RotationOverLife,
  ApplyForce,
  SphereEmitter,
  HemisphereEmitter,
  ConeEmitter,
  PointEmitter,
  Vector3 as QVec3,
  Vector4 as QVec4,
} from 'three.quarks'
import { loadCocosConfig } from './cocosPlist.js'

/**
 * Cocos2d 粒子 → three.js 3D 版（基于 three.quarks）
 *
 * 与 2D 版（cocosParticles.js）共用 plist 解析，参数翻译成 quarks 发射器：
 * - 2D 全平面散开（angleVar≥135°）→ 球形/半球发射
 * - 2D 定向喷射（烟/火向上）→ 锥形发射（绕 X 转 -90° 使 +Z 指向世界 +Y）
 * - blastWave / flatGlow → 贴地水平 billboard（HorizontalBillBoard）
 * - sparkFlare 闪光条 → 沿速度拉伸（StretchedBillBoard）
 * - .m 自定义曲线 → SizeOverLife / SpeedOverLife 分段线性 + 自定义 alpha behavior
 *
 * 用法：
 *   const batch = createBatchRenderer(scene)          // 每帧 batch.update(dt)
 *   playCocosEffect3D(scene, batch, 'bigBang', { position: new THREE.Vector3(0,0,0) })
 */

const BASE = '/res/cocos-particles'
const DEG = Math.PI / 180
/** cocos 像素 → three 世界单位 */
const UNIT = 0.013

/* ------------------------------- 工具 ------------------------------- */

/** 分段线性曲线：points = [[t, v], ...]，t 升序覆盖 0..1 */
function linCurve(points) {
  const segs = []
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, v0] = points[i]
    const [, v1] = points[i + 1]
    segs.push([new Bezier(v0, v0 + (v1 - v0) / 3, v0 + (2 * (v1 - v0)) / 3, v1), t0])
  }
  return new PiecewiseBezier(segs)
}

function iv(base, variance) {
  return variance ? new IntervalValue(base - variance, base + variance) : new ConstantValue(base)
}

/** 自定义逐粒子行为（补 quarks 没有的 alpha 曲线等） */
function customBehavior(onUpdate) {
  return {
    type: 'CocosCurve',
    initialize() {},
    update(p) {
      onUpdate(p, p.age / Math.max(p.life, 1e-6))
    },
    frameUpdate() {},
    toJSON() {
      return { type: 'CocosCurve' }
    },
    clone() {
      return this
    },
    reset() {},
  }
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 分段线性求值（自定义 behavior 用，points 同 linCurve） */
function evalLin(points, t) {
  if (t <= points[0][0]) return points[0][1]
  for (let i = 0; i < points.length - 1; i++) {
    const [t0, v0] = points[i]
    const [t1, v1] = points[i + 1]
    if (t <= t1) return v0 + ((t - t0) / Math.max(t1 - t0, 1e-6)) * (v1 - v0)
  }
  return points[points.length - 1][1]
}

/* ------------------------------- 贴图 ------------------------------- */

const _texCache = new Map()
const _texLoader = new THREE.TextureLoader()

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
  _fallbackTex = new THREE.CanvasTexture(c)
  return _fallbackTex
}

function loadTexture3D(url) {
  if (!url) return Promise.resolve(fallbackTexture())
  if (_texCache.has(url)) return _texCache.get(url)
  const p = new Promise((resolve) => {
    _texLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        resolve(tex)
      },
      undefined,
      () => resolve(fallbackTexture())
    )
  })
  _texCache.set(url, p)
  return p
}

/* --------------------------- 参数翻译 --------------------------- */

/**
 * 发射形状（2D→3D 语义决策）
 * spec: 'sphere' | 'hemi' | 'cone' | 'point'，cone/hemi 轴向上
 * @returns {{ shape, rotX }} rotX 应用到 emitter（quarks 锥/半球本地 +Z 轴）
 */
function makeShape(spec, c, unitScale) {
  const r = Math.max(0.02, (Math.max(c.posVarX, c.posVarY) || 2) * UNIT * unitScale)
  switch (spec) {
    case 'hemi':
      return { shape: new HemisphereEmitter({ radius: r, thickness: 1 }), rotX: -Math.PI / 2 }
    case 'cone':
      return {
        shape: new ConeEmitter({ radius: r, thickness: 1, angle: Math.min(80, c.angleVar || 30) * DEG }),
        rotX: -Math.PI / 2,
      }
    case 'point':
      return { shape: new PointEmitter(), rotX: 0 }
    case 'ring':
      // canBlast 的环：薄球壳近似 cocos 半径模式
      return { shape: new SphereEmitter({ radius: c.startRadius * UNIT * unitScale, thickness: 0.2 }), rotX: 0 }
    case 'sphere':
    default:
      return { shape: new SphereEmitter({ radius: r, thickness: 1 }), rotX: 0 }
  }
}

/**
 * cocos config + 层选项 → quarks ParticleSystem
 * opts: { shape, renderMode, size, speed, alpha, overrides, unitScale }
 */
function cocosToSystem(config, texture, opts = {}) {
  const c = { ...config, ...(opts.overrides || {}) }
  const k = opts.unitScale || 1
  const life = c.lifespan
  const rate = c.emissionRate || c.maxParticles / life

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: c.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })

  const behaviors = [
    new ColorOverLife(
      new Gradient(
        [
          [new QVec3(c.startColor[0], c.startColor[1], c.startColor[2]), 0],
          [new QVec3(c.endColor[0], c.endColor[1], c.endColor[2]), 1],
        ],
        [
          [c.startColor[3], 0],
          [c.endColor[3], 1],
        ]
      )
    ),
  ]

  if (opts.sizeXY) {
    // 宽高独立曲线（flatGlow 光带等，.m 的 widthScale/heightScale）
    const { w, h } = opts.sizeXY
    behaviors.push(
      customBehavior((p, t) => {
        p.size.x = p.startSize.x * evalLin(w, t)
        p.size.y = p.startSize.y * evalLin(h, t)
      })
    )
  } else if (opts.size) {
    behaviors.push(new SizeOverLife(linCurve(opts.size)))
  } else if (c.endSize !== c.startSize) {
    behaviors.push(new SizeOverLife(linCurve([[0, 1], [1, c.endSize / Math.max(c.startSize, 1e-3)]])))
  }

  if (opts.speed) behaviors.push(new SpeedOverLife(linCurve(opts.speed)))

  if (c.gravityY) {
    behaviors.push(
      new ApplyForce(new QVec3(0, Math.sign(c.gravityY), 0), new ConstantValue(Math.abs(c.gravityY) * UNIT * k))
    )
  }

  const drot = c.rotationEnd - c.rotationStart
  if (drot || c.rotationEndVar || c.rotationStartVar) {
    const spread = (c.rotationEndVar + c.rotationStartVar) * DEG
    behaviors.push(new RotationOverLife(new IntervalValue((drot * DEG - spread) / life, (drot * DEG + spread) / life)))
  }

  if (opts.alpha) {
    behaviors.push(
      customBehavior((p, t) => {
        p.color.w = clamp01(opts.alpha(t))
      })
    )
  }

  const { shape, rotX } = makeShape(opts.shape || 'sphere', c, k)

  const stretched = opts.renderMode === RenderMode.StretchedBillBoard
  const ps = new ParticleSystem({
    duration: c.duration < 0 ? 1 : Math.max(0.05, c.duration),
    looping: false,
    autoDestroy: true,
    shape,
    startLife: iv(life, c.lifespanVar),
    startSpeed: iv(c.speed * UNIT * k, c.speedVar * UNIT * k),
    startSize: iv(c.startSize * UNIT * k, c.startSizeVar * UNIT * k),
    startRotation: iv(-c.rotationStart * DEG, c.rotationStartVar * DEG),
    startColor: new ConstantColor(new QVec4(1, 1, 1, 1)),
    emissionOverTime: new ConstantValue(rate),
    behaviors,
    material,
    renderMode: opts.renderMode ?? RenderMode.BillBoard,
    rendererEmitterSettings: stretched ? { speedFactor: 0.06, lengthFactor: 2.2 } : undefined,
    worldSpace: true,
  })
  ps.emitter.rotation.x = rotX
  if (opts.y) ps.emitter.position.y = opts.y
  // 该层粒子全部放完的时刻（供整体清理）
  ps._cocosTTL = (c.duration < 0 ? 1 : c.duration) + life + c.lifespanVar + 0.3
  return ps
}

/* --------------------------- 特效表 --------------------------- */

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
  flatGlow: `${BASE}/glow/flatGlow.plist`,
  implodingGlow: `${BASE}/glow/implodingGlow.plist`,
  blastWave: `${BASE}/glow/blastWave.plist`,
  dustFlare: `${BASE}/dust/dustFlare.plist`,
  dustBurst: `${BASE}/dust/dustBurst.plist`,
  dustRise: `${BASE}/dust/dustRise.plist`,
  armCloud: `${BASE}/smoke/armCloud.plist`,
  toonCloud: `${BASE}/smoke/toonCloud.plist`,
}

// .m 自定义曲线的 3D 表达（分段线性点列 + alpha 函数）
const CURVES = {
  growingFlareSize: [[0, 0], [0.4, 0.4], [1, 0.8]],
  growingFlareSpeed: [[0, 2.2], [0.23, 0.41], [1, 0]],
  sparkSize: [[0, 0.05], [1, 1]],
  sparkSpeed: [[0, 1], [1, 0.6]],
  candleSize: [[0, 1.2], [1, 0.2]],
  candleSpeed: [[0, 0.45], [0.06, 0.12], [1, 0.02]],
  waveSize: [[0, 0.05], [1, 1]],
  starGlowSize: [[0, 0.8], [0.6, 1.4], [1, 1.4]],
  implodingGlowSize: [[0, 0.05], [0.9, 2.0], [0.92, 0.4], [1, 0.05]],
  implodingSpeed: [[0, 1.5], [1, 1.4]],
  flatGlowSize: [[0, 0.2], [0.8, 2.4], [1, 5]],
}
const ALPHAS = {
  fadeInOut: (t) => (t < 0.5 ? 2 * t : 2 - 2 * t),
  quickIn: (t) => (t <= 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9),
  starGlow: (t) => (t <= 0.03 ? 3 * t : 0.9 - 0.9 * t),
  implodingGlow: (t) => (t <= 0.5 ? 0.2 : 2 * t - 1),
}

/**
 * 每层：{ src, shape, renderMode, size, speed, alpha, overrides, unitScale }
 * 与 2D 版 COCOS_EFFECTS 对应，形状/朝向按 3D 语义重新选择。
 */
export const COCOS_EFFECTS_3D = {
  flare: () => [{ src: 'burningFlare', shape: 'cone' }],
  chaoticFlare: () => [{ src: 'chaoticFlare', shape: 'cone' }],
  candleFlare: () => [{ src: 'candleFlare', shape: 'cone', size: CURVES.candleSize, speed: CURVES.candleSpeed, alpha: ALPHAS.quickIn }],
  growingFlare: () => [{ src: 'growingFlare', shape: 'sphere', size: CURVES.growingFlareSize, speed: CURVES.growingFlareSpeed }],
  // 光痕闪光：竖向光痕贴图随机角度绽放（原版由节点随机旋转实现）
  sparkFlare: () => [
    { src: 'sparkFlare', shape: 'sphere', size: CURVES.sparkSize, speed: CURVES.sparkSpeed, overrides: { maxParticles: 16, rotationStartVar: 180 } },
  ],
  blastWave: () => [
    { src: 'blastWave', shape: 'point', renderMode: RenderMode.HorizontalBillBoard, size: CURVES.waveSize },
  ],
  dustRise: () => [{ src: 'dustRise', shape: 'cone' }],

  burstFlare: () => [
    { src: 'implodingFlare', shape: 'sphere', speed: CURVES.implodingSpeed, alpha: ALPHAS.fadeInOut },
    { src: 'burstFlare', shape: 'sphere' },
  ],
  groundExplode: () => [
    { src: 'dustFlare', shape: 'hemi' },
    { src: 'dustFlare', shape: 'hemi', overrides: { startColor: [1, 0.5, 0.3, 1], endColor: [1, 0.5, 0.3, 0] } },
    { src: 'dustBurst', shape: 'cone' },
    { src: 'dustRise', shape: 'cone' },
    { src: 'blastWave', shape: 'point', renderMode: RenderMode.HorizontalBillBoard, size: CURVES.waveSize, overrides: { maxParticles: 1, startSize: 420, startColor: [0.9, 0.75, 0.6, 0.5] } },
  ],
  armExplode: () => [
    { src: 'toonCloud', shape: 'hemi' },
    { src: 'armCloud', shape: 'cone' },
    { src: 'pangFlare', shape: 'sphere' },
  ],
  cartoonExplode: () => [
    { src: 'candleFlare', shape: 'cone', size: CURVES.candleSize, speed: CURVES.candleSpeed, alpha: ALPHAS.quickIn },
    { src: 'toonCloud', shape: 'hemi', overrides: { startColor: [1, 0.5, 0.3, 1], endColor: [0.8, 0.3, 0.1, 0] } },
  ],
  areaBang: () => [
    { src: 'blastWave', shape: 'point', renderMode: RenderMode.HorizontalBillBoard, size: CURVES.waveSize, overrides: { startColor: [1, 0.7, 0.45, 0.85] } },
    { src: 'growingFlare', shape: 'sphere', size: CURVES.growingFlareSize, speed: CURVES.growingFlareSpeed },
    { src: 'sparkFlare', shape: 'sphere', size: CURVES.sparkSize, speed: CURVES.sparkSpeed, overrides: { maxParticles: 12, rotationStartVar: 180 } },
  ],
  // 核弹式白闪：主星光 + 横贯的扁平光带（flatGlow 宽高独立曲线）+ 环状辉光 + 爆缩，中心抬离地面
  bigBang: () => [
    { src: 'circleGlow', shape: 'sphere', y: 1.3, unitScale: 1.5 },
    { src: 'starGlow', shape: 'point', y: 1.3, size: CURVES.starGlowSize, alpha: ALPHAS.starGlow, overrides: { startSize: 520 } },
    {
      src: 'flatGlow',
      shape: 'point',
      y: 1.3,
      sizeXY: { w: [[0, 0.4], [0.8, 9], [1, 16]], h: [[0, 0.55], [0.5, 0.3], [1, 0.05]] },
      overrides: { startSize: 130, maxParticles: 3 },
    },
    { src: 'implodingGlow', shape: 'point', y: 1.3, size: CURVES.implodingGlowSize, alpha: ALPHAS.implodingGlow, overrides: { startSize: 340 } },
  ],
  canBlast: () => {
    const layers = []
    for (let i = 0; i < 3; i++) {
      const k = 1.2 + Math.random() * 1.3
      layers.push({
        src: 'growingFlare',
        shape: 'ring',
        unitScale: k,
        size: CURVES.growingFlareSize,
        overrides: {
          maxParticles: 26,
          startSize: 110,
          startSizeVar: 50,
          endSize: 4,
          lifespan: 1.3,
          startRadius: 30,
          speed: (60 - 30) / 1.3,
          speedVar: 12,
          emissionRate: 26 / 1.3,
        },
      })
    }
    // 原版：单个光痕被拉长后随机角度摆放，这里用少量大光痕随机角度闪现近似
    layers.push({
      src: 'sparkFlare',
      shape: 'sphere',
      size: CURVES.sparkSize,
      speed: CURVES.sparkSpeed,
      overrides: { maxParticles: 6, startSize: 380, startSizeVar: 120, duration: 0.3, rotationStartVar: 180 },
    })
    layers.push({
      src: 'blastWave',
      shape: 'point',
      renderMode: RenderMode.HorizontalBillBoard,
      size: CURVES.waveSize,
      overrides: { maxParticles: 2, startSize: 500, startSizeVar: 100, endSize: 500, duration: 0.3, emissionRate: 2 / 0.3 },
    })
    return layers
  },
}

/* --------------------------- 播放入口 --------------------------- */

/** 创建粒子批渲染器并挂到场景；调用方每帧执行 renderer.update(dtSec) */
export function createBatchRenderer(scene) {
  const batch = new BatchedRenderer()
  scene.add(batch)
  return batch
}

/**
 * 播放组合特效
 * @param {THREE.Scene|THREE.Object3D} parent
 * @param {BatchedRenderer} batchRenderer  demo 每帧调用其 update(dt)
 * @param {string} name COCOS_EFFECTS_3D 键名
 * @param {object} [opts] { position: THREE.Vector3, scale = 1 }
 * @returns {Promise<void>} 全部粒子放完后 resolve（并清理节点）
 */
export async function playCocosEffect3D(parent, batchRenderer, name, opts = {}) {
  const def = COCOS_EFFECTS_3D[name]
  if (!def) {
    console.warn('[cocosFx3d] unknown effect', name)
    return
  }
  const layers = def()
  const loaded = await Promise.all(
    layers.map(async (l) => {
      try {
        const { config, textureUrl } = await loadCocosConfig(SRC[l.src])
        const texture = await loadTexture3D(textureUrl)
        return { config, texture }
      } catch (e) {
        console.warn('[cocosFx3d] load fail', l.src, e)
        return null
      }
    })
  )

  const group = new THREE.Object3D()
  if (opts.position) group.position.copy(opts.position)
  if (opts.scale) group.scale.setScalar(opts.scale)
  parent.add(group)

  let maxTTL = 0
  layers.forEach((l, i) => {
    if (!loaded[i]) return
    const ps = cocosToSystem(loaded[i].config, loaded[i].texture, l)
    group.add(ps.emitter)
    batchRenderer.addSystem(ps)
    maxTTL = Math.max(maxTTL, ps._cocosTTL)
  })

  await new Promise((resolve) => setTimeout(resolve, maxTTL * 1000))
  parent.remove(group)
}

export function listCocosEffects3D() {
  return Object.keys(COCOS_EFFECTS_3D)
}
