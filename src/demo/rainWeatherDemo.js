/**
 * 雨天积水 Demo · 俯角等距 2D 地图
 *
 * 对应教程管线（Godot SubViewport → Pixi RenderTexture + 自定义 Filter）：
 * 1. 雨滴粒子 + 落地飞溅子发射
 * 2. 造波噪声 step 裁切积水形状；向内切一层 + 移动扫波做边缘
 * 3. 水波纹粒子渲进 RT：红通道 = 波强(可见涟漪/泡沫)，绿蓝通道 = 扰动向量
 * 4. 角色踩水发射波纹粒子 + 湿脚步音
 * 5. 物体/角色 scale.y 翻转倒影渲进 RT + 底部天空倒影
 * 6. 绿蓝通道扰动反射 UV（反射折射效果）
 * 7. 直接采样屏幕纹理，用同款 UV 做折射扭曲
 * 8. 根据造波值设置反射透明度
 */
import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from '../config.js'
import { paintIsoArena } from '../maps/IsoTileBuilder.js'

const W = DESIGN_WIDTH
const H = DESIGN_HEIGHT

async function main() {
  const host = document.getElementById('host')
  const app = new PIXI.Application({
    width: W,
    height: H,
    backgroundColor: 0x0a0e16,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  })
  host.appendChild(app.view)
  app.view.style.width = '100%'
  app.view.style.height = '100%'

  // —— 世界层 ——
  // groundRoot 上挂水面 Filter：折射只扭曲地面，水面画在道具/角色之下
  const world = new PIXI.Container()
  app.stage.addChild(world)

  const groundRoot = new PIXI.Container()
  const far = new PIXI.Container()
  const mid = new PIXI.Container()
  groundRoot.addChild(far, mid)

  const propLayer = new PIXI.Container()
  const actorLayer = new PIXI.Container()
  const rainLayer = new PIXI.Container()
  const near = new PIXI.Container()
  world.addChild(groundRoot, propLayer, actorLayer, rainLayer, near)

  const mapInfo = paintIsoArena(app.renderer, { far, mid, near }, {
    seed: 21,
    gridW: 14,
    gridH: 14,
    noRings: true, // 静态椭圆环不参与旋转，会穿帮
  })
  // demo 不要暗角抢戏
  near.removeChildren()

  // —— 伪 3D 摄像机：绕焦点(战场中心)旋转 + 缩放 ——
  // 所有东西存逻辑网格坐标 (li,lj)，每帧实时算 2D 渲染坐标；
  // 贴图本身不旋转不变形，只有位置变——即视频里那套自制 tilemap 的做法
  const cam = { rot: 0, zoom: 1, cos: 1, sin: 0 }
  const halfW = mapInfo.TW / 2
  const halfH = mapInfo.TH / 2
  /** 逻辑坐标 → 屏幕（先旋转再等距投影） */
  function project(li, lj) {
    const ir = li * cam.cos - lj * cam.sin
    const jr = li * cam.sin + lj * cam.cos
    return {
      x: mapInfo.ox + (ir - jr) * halfW * cam.zoom,
      y: mapInfo.oy + (ir + jr) * halfH * cam.zoom,
    }
  }
  /** 屏幕 → 逻辑坐标（反投影再反旋转） */
  function invert(x, y) {
    const a = (x - mapInfo.ox) / (halfW * cam.zoom)
    const b = (y - mapInfo.oy) / (halfH * cam.zoom)
    const ir = (b + a) / 2
    const jr = (b - a) / 2
    return { li: ir * cam.cos + jr * cam.sin, lj: -ir * cam.sin + jr * cam.cos }
  }

  // —— 场景物体（柱/石，供倒影用）——
  const props = buildProps(mapInfo)
  for (const p of props) {
    propLayer.addChild(p.view)
    const l = invert(p.x, p.y)
    p.li = l.li
    p.lj = l.lj
  }

  // —— 角色 ——
  const hero = createHero(mapInfo.ox, mapInfo.oy + mapInfo.TH * 4.2)
  actorLayer.addChild(hero.view)
  {
    const l = invert(hero.x, hero.y)
    hero.li = l.li
    hero.lj = l.lj
  }

  // —— 雨天积水系统 ——
  const weather = new RainWeatherSystem(app, {
    groundRoot,
    rainLayer,
    props,
    hero,
    mapInfo,
    cam,
  })
  await weather.init()

  // —— 输入 ——
  const keys = new Set()
  const target = { x: hero.x, y: hero.y, active: false }
  window.addEventListener('keydown', (e) => {
    keys.add(e.key.toLowerCase())
    if (e.key.toLowerCase() === 'r') weather.toggleRain()
    if (e.key.toLowerCase() === 'p') weather.togglePuddles()
  })
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
  app.view.addEventListener('pointerdown', (ev) => {
    const rect = app.view.getBoundingClientRect()
    target.x = ((ev.clientX - rect.left) / rect.width) * W
    target.y = ((ev.clientY - rect.top) / rect.height) * H
    target.active = true
  })
  // 滚轮：绕焦点缩放
  app.view.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault()
      cam.zoom = clamp(cam.zoom * (ev.deltaY > 0 ? 0.92 : 1.08), 0.55, 1.8)
    },
    { passive: false }
  )

  // 点击解锁音频
  const unlock = () => {
    weather.audio.unlock()
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('pointerdown', unlock)

  let lastOnWater = false
  app.ticker.add(() => {
    const dt = Math.min(0.05, app.ticker.deltaMS / 1000)

    // Q/E：绕焦点旋转视角
    if (keys.has('q')) cam.rot += dt * 1.1
    if (keys.has('e')) cam.rot -= dt * 1.1
    cam.cos = Math.cos(cam.rot)
    cam.sin = Math.sin(cam.rot)

    // 移动（屏幕方向输入 → 换算回逻辑坐标存储）
    let vx = 0
    let vy = 0
    if (keys.has('w') || keys.has('arrowup')) vy -= 1
    if (keys.has('s') || keys.has('arrowdown')) vy += 1
    if (keys.has('a') || keys.has('arrowleft')) vx -= 1
    if (keys.has('d') || keys.has('arrowright')) vx += 1
    let sx = hero.x
    let sy = hero.y
    if (vx || vy) {
      const len = Math.hypot(vx, vy) || 1
      sx += (vx / len) * 190 * dt
      sy += (vy / len) * 105 * dt // 俯角：纵向移动视觉上更慢
      target.active = false
    } else if (target.active) {
      const dx = target.x - hero.x
      const dy = target.y - hero.y
      const d = Math.hypot(dx, dy)
      if (d < 6) target.active = false
      else {
        sx += (dx / d) * 190 * dt
        sy += (dy / d) * 105 * dt
      }
    }
    if (sx !== hero.x || sy !== hero.y) {
      const l = invert(sx, sy)
      hero.li = l.li
      hero.lj = l.lj
    }
    // 限制在菱形战场范围内（逻辑空间半径）
    const hr = Math.hypot(hero.li, hero.lj)
    if (hr > 6.2) {
      hero.li *= 6.2 / hr
      hero.lj *= 6.2 / hr
    }

    // —— 伪 3D：所有物体按逻辑坐标实时重算 2D 渲染坐标 ——
    // 菱形瓦片只在 90° 整数倍无缝；中间角度把瓦片放大一点互相重叠补缝
    const gapFill = 1 + 0.5 * Math.abs(Math.sin(2 * cam.rot))
    for (const t of mapInfo.floorTiles) {
      const pos = project(t.li, t.lj)
      t.spr.x = pos.x
      t.spr.y = pos.y
      t.spr.scale.set(cam.zoom * gapFill)
    }
    for (const p of props) {
      const pos = project(p.li, p.lj)
      p.view.x = pos.x
      p.view.y = pos.y
      p.view.scale.set(cam.zoom)
    }
    {
      const pos = project(hero.li, hero.lj)
      hero.x = pos.x
      hero.y = pos.y
      hero.view.x = pos.x
      hero.view.y = pos.y
      hero.view.scale.set(cam.zoom)
    }
    actorLayer.children.sort((a, b) => (a.y || 0) - (b.y || 0))
    propLayer.children.sort((a, b) => (a.y || 0) - (b.y || 0))

    const moving = !!(vx || vy || target.active)
    const onWater = weather.isOnPuddle(hero.x, hero.y)
    weather.update(dt, { x: hero.x, y: hero.y, onWater, moving })

    if (onWater && !lastOnWater) weather.audio.playWetStep()
    if (onWater && moving && Math.random() < dt * 4) {
      weather.audio.playWetStep()
    }
    lastOnWater = onWater

    // 湿脚：角色颜色微蓝
    hero.body.tint = onWater ? 0xb8d4e8 : 0xf0e6d8
  })

  // 供自动化测试探水坑位置 / 控制摄像机
  window.__rainDemo = {
    weather,
    hero,
    target,
    cam,
    setCamera(rot, zoom) {
      cam.rot = rot
      if (zoom != null) cam.zoom = zoom
      cam.cos = Math.cos(cam.rot)
      cam.sin = Math.sin(cam.rot)
    },
  }
}

// ─────────────────────────────────────────────
// 水面着色器：教程 2/6/7/8 步全在这里
// ─────────────────────────────────────────────
const WATER_FRAG = `
precision highp float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec4 inputClamp;

uniform sampler2D uNoise;    // 造波噪声：r=形状 fbm，g/b=辅助噪声
uniform sampler2D uRipple;   // 波纹 RT：r=波强，gb=扰动向量
uniform sampler2D uReflect;  // 倒影 RT
uniform float uTime;
uniform vec2  uScreen;       // 设计分辨率
uniform vec2  uOrigin;       // 等距投影原点（战场中心/旋转焦点）
uniform vec2  uHalfIso;      // (TW/2, TH/2) × zoom
uniform vec2  uRot;          // (cos, sin)：摄像机旋转
uniform float uCut;          // step 裁切阈值
uniform float uOn;

void main(void) {
  vec2 px  = vTextureCoord * inputSize.xy + outputFrame.xy;
  vec2 suv = px / uScreen;
  vec4 base = texture2D(uSampler, vTextureCoord);

  // 屏幕 → 逻辑网格坐标（反等距投影 + 反旋转）——积水黏在地面上跟着转
  vec2 ab = (px - uOrigin) / uHalfIso;
  float ir = (ab.y + ab.x) * 0.5;
  float jr = (ab.y - ab.x) * 0.5;
  float li =  ir * uRot.x + jr * uRot.y;
  float lj = -ir * uRot.y + jr * uRot.x;

  // 战场范围衰减（逻辑空间半径）
  float er = li * li + lj * lj;
  float fade = 1.0 - smoothstep(22.0, 42.0, er);

  // 造波纹理 + step 裁切积水形状（逻辑空间采样）
  vec2 nuv = vec2(li, lj) * 0.055;
  float n = texture2D(uNoise, nuv).r * fade;
  float pud   = smoothstep(uCut, uCut + 0.012, n) * uOn;
  float inner = smoothstep(uCut + 0.05, uCut + 0.09, n);
  float edge  = pud * (1.0 - inner);

  if (pud < 0.004) { gl_FragColor = base; return; }

  // 波纹 RT：红=波强，绿蓝=扰动
  vec4 rip = texture2D(uRipple, suv);
  vec2 disp = (rip.gb - vec2(0.5)) * 2.0;
  float wave = clamp(rip.r, 0.0, 1.0);

  // 水面常驻微扰（噪声随时间滚动）
  vec2 nd = texture2D(uNoise, nuv * 3.0 + vec2(uTime * 0.021, uTime * 0.013)).gb - vec2(0.5);

  // 倒影：扰动 UV 采样（教程第 6 步）
  vec2 ruv = suv + disp * 0.030 + nd * 0.012;
  vec3 refl = texture2D(uReflect, clamp(ruv, vec2(0.002), vec2(0.998))).rgb;

  // 折射：同款 UV 采样屏幕纹理（教程第 7 步）
  vec2 rpx = px + disp * 26.0 + nd * 9.0;
  vec2 fuv = (rpx - outputFrame.xy) * inputSize.zw;
  vec3 refr = texture2D(uSampler, clamp(fuv, inputClamp.xy, inputClamp.zw)).rgb;

  // 水体 = 折射地面加深 + 蓝调
  vec3 water = refr * 0.55 + vec3(0.010, 0.030, 0.055);

  // 反射透明度随造波值衰减（教程第 8 步：波纹处倒影破碎）
  float reflA = clamp(0.40 - wave * 0.38, 0.05, 0.40);
  water = mix(water, refl, reflA);

  // 波纹白沫：红通道直接可见
  water += vec3(0.70, 0.82, 0.92) * wave * 0.38;

  // 边缘：内切一层 + 移动扫波高光
  float sweep = texture2D(uNoise, nuv * 2.2 + vec2(uTime * 0.04, -uTime * 0.022)).b;
  water += vec3(0.50, 0.66, 0.78) * edge * (0.16 + 0.6 * sweep * sweep);

  gl_FragColor = vec4(mix(base.rgb, water, pud * 0.92), base.a);
}
`

// ─────────────────────────────────────────────
// 雨天积水系统
// ─────────────────────────────────────────────
class RainWeatherSystem {
  constructor(app, opts) {
    this.app = app
    this.opts = opts
    this.rainOn = true
    this.puddleOn = true
    this.audio = new RainAudio()
    this.drops = []
    this.splashes = []
    this.ripples = []
    this.time = 0
    this._footAcc = 0
    this._rainAcc = 0
    this.cut = 0.6
  }

  async init() {
    const { app, opts } = this
    const { mapInfo } = opts

    // 造波噪声（CPU 保留一份数据，供 isOnPuddle 与 shader 完全一致）
    this.noise = makeWaveNoise(256)

    // 波纹 RT / 倒影 RT（= 教程里的两个 SubViewport）
    this.rippleRT = PIXI.RenderTexture.create({ width: W, height: H })
    this.reflectRT = PIXI.RenderTexture.create({ width: W, height: H })

    // 水面 Filter 挂到地面层（噪声/衰减在逻辑空间采样，跟随摄像机旋转缩放）
    const cam = opts.cam
    this.waterFilter = new PIXI.Filter(undefined, WATER_FRAG, {
      uNoise: this.noise.texture,
      uRipple: this.rippleRT,
      uReflect: this.reflectRT,
      uTime: 0,
      uScreen: [W, H],
      uOrigin: [mapInfo.ox, mapInfo.oy],
      uHalfIso: [(mapInfo.TW / 2) * cam.zoom, (mapInfo.TH / 2) * cam.zoom],
      uRot: [cam.cos, cam.sin],
      uCut: this.cut,
      uOn: 1,
    })
    this.waterFilter.resolution = app.renderer.resolution
    opts.groundRoot.filterArea = new PIXI.Rectangle(0, 0, W, H)
    opts.groundRoot.filters = [this.waterFilter]

    // 波纹粒子场景（渲进 rippleRT）
    this.rippleScene = new PIXI.Container()
    this.rippleClear = new PIXI.Graphics()
    // 中性底：r=0 无波，gb=0.5 无扰动
    this.rippleClear.beginFill(0x008080)
    this.rippleClear.drawRect(0, 0, W, H)
    this.rippleClear.endFill()
    this.rippleTex = makeRippleTexture(128)

    // 倒影场景：天空渐变 + 翻转物体（渲进 reflectRT）
    this.reflectScene = new PIXI.Container()
    this.reflectScene.addChild(makeSkySprite())
    this.reflectProps = new PIXI.Container()
    this.reflectScene.addChild(this.reflectProps)

    // 共享 geometry 翻转倒影（= 教程 multimesh scale 翻转再渲一遍）
    for (const p of opts.props) {
      const clone = new PIXI.Graphics(p.gfx.geometry)
      clone.x = p.view.x
      clone.y = p.view.y
      clone.scale.y = -1
      clone.alpha = 0.8
      clone.tint = 0xb0c8dc
      this.reflectProps.addChild(clone)
      p._reflect = clone
    }
    // 主角倒影
    this.heroReflect = new PIXI.Graphics(opts.hero.body.geometry)
    this.heroReflect.scale.y = -1
    this.heroReflect.alpha = 0.7
    this.heroReflect.tint = 0xb0c8dc
    this.reflectProps.addChild(this.heroReflect)

    // 雨滴纹理
    this.dropTex = makeDropTexture()
    this.splashTex = makeSplashTexture()

    this.audio.startRainLoop()
  }

  toggleRain() {
    this.rainOn = !this.rainOn
    if (this.rainOn) this.audio.startRainLoop()
    else this.audio.stopRainLoop()
  }

  togglePuddles() {
    this.puddleOn = !this.puddleOn
    this.waterFilter.uniforms.uOn = this.puddleOn ? 1 : 0
  }

  /** 与 shader 同款采样：屏幕 → 逻辑坐标 → 噪声 fbm × 范围衰减 */
  puddleValueAt(x, y) {
    const { mapInfo, cam } = this.opts
    const a = (x - mapInfo.ox) / ((mapInfo.TW / 2) * cam.zoom)
    const b = (y - mapInfo.oy) / ((mapInfo.TH / 2) * cam.zoom)
    const ir = (b + a) / 2
    const jr = (b - a) / 2
    const li = ir * cam.cos + jr * cam.sin
    const lj = -ir * cam.sin + jr * cam.cos
    const er = li * li + lj * lj
    const fade = 1 - smoothstep01((er - 22) / 20)
    if (fade <= 0) return 0
    return this.noise.sampleR(li * 0.055, lj * 0.055) * fade
  }

  isOnPuddle(x, y) {
    if (!this.puddleOn) return false
    return this.puddleValueAt(x, y) > this.cut + 0.02
  }

  update(dt, hero) {
    this.time += dt
    const { rainLayer, mapInfo, cam } = this.opts
    this.waterFilter.uniforms.uTime = this.time
    // 摄像机旋转/缩放同步给水面着色器
    this.waterFilter.uniforms.uHalfIso = [(mapInfo.TW / 2) * cam.zoom, (mapInfo.TH / 2) * cam.zoom]
    this.waterFilter.uniforms.uRot = [cam.cos, cam.sin]

    // 1) 雨滴
    if (this.rainOn) {
      this._rainAcc += dt * 150
      while (this._rainAcc >= 1) {
        this._rainAcc -= 1
        this.spawnDrop()
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]
      d.x += d.vx * dt
      d.y += d.vy * dt
      d.spr.x = d.x
      d.spr.y = d.y
      d.life -= dt
      if (d.y >= d.groundY || d.life <= 0) {
        // 落地飞溅（子发射器）
        const onPud = this.puddleOn && this.isOnPuddle(d.x, d.groundY)
        this.spawnSplash(d.x, d.groundY, onPud ? 4 : 2)
        if (onPud) this.spawnRipple(d.x, d.groundY, 0.3 + Math.random() * 0.3)
        rainLayer.removeChild(d.spr)
        d.spr.destroy()
        this.drops.splice(i, 1)
      }
    }

    // 飞溅粒子
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]
      s.age += dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += 420 * dt
      const t = s.age / s.life
      s.spr.x = s.x
      s.spr.y = s.y
      s.spr.alpha = 1 - t
      s.spr.scale.set(s.sc0 * (1 + t * 0.4))
      if (t >= 1) {
        rainLayer.removeChild(s.spr)
        s.spr.destroy()
        this.splashes.splice(i, 1)
      }
    }

    // 2) 角色踩水：波纹 + 溅水粒子
    if (hero.onWater && hero.moving && this.puddleOn) {
      this._footAcc += dt
      if (this._footAcc > 0.13) {
        this._footAcc = 0
        this.spawnRipple(hero.x, hero.y + 4, 0.85)
        this.spawnSplash(hero.x + (Math.random() - 0.5) * 14, hero.y + 4, 3)
      }
    }

    // 3) 波纹粒子 → rippleRT（红=波强，绿蓝=扰动向量）
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.age += dt
      const u = r.age / r.life
      if (u >= 1) {
        this.rippleScene.removeChild(r.spr)
        r.spr.destroy()
        this.ripples.splice(i, 1)
        continue
      }
      const ease = 1 - (1 - u) * (1 - u)
      const rad = r.r0 + ease * r.rGrow
      r.spr.scale.set(rad / 40, (rad / 40) * 0.5)
      r.spr.alpha = Math.pow(1 - u, 1.3) * r.power
    }
    this.app.renderer.render(this.rippleClear, this.rippleRT, true)
    this.app.renderer.render(this.rippleScene, this.rippleRT, false)

    // 4) 倒影：同步翻转物体位置/缩放，渲进 reflectRT
    for (const p of this.opts.props) {
      if (!p._reflect) continue
      p._reflect.x = p.view.x
      p._reflect.y = p.view.y
      p._reflect.scale.set(cam.zoom, -cam.zoom)
    }
    this.heroReflect.x = hero.x
    this.heroReflect.y = hero.y
    this.heroReflect.scale.set(cam.zoom, -cam.zoom)
    this.app.renderer.render(this.reflectScene, this.reflectRT, true)
  }

  spawnDrop() {
    // 落点集中在战场附近
    const x = W * 0.08 + Math.random() * W * 0.84
    const y = -40 - Math.random() * 120
    const groundY = H * (0.1 + Math.random() * 0.55)
    const spr = new PIXI.Sprite(this.dropTex)
    spr.anchor.set(0.5, 1)
    spr.rotation = 0.1
    spr.scale.set(0.35 + Math.random() * 0.3, 0.9 + Math.random() * 0.7)
    spr.alpha = 0.3 + Math.random() * 0.35
    spr.tint = 0xb8d4e8
    spr.x = x
    spr.y = y
    this.opts.rainLayer.addChild(spr)
    this.drops.push({
      spr,
      x,
      y,
      vx: -60 - Math.random() * 50,
      vy: 620 + Math.random() * 300,
      groundY,
      life: 2.4,
    })
  }

  spawnSplash(x, y, count = 3) {
    const n = count + ((Math.random() * 2) | 0)
    for (let i = 0; i < n; i++) {
      const spr = new PIXI.Sprite(this.splashTex)
      spr.anchor.set(0.5)
      spr.tint = 0xc8e0f0
      const sc = 0.12 + Math.random() * 0.2
      spr.scale.set(sc)
      spr.x = x
      spr.y = y
      this.opts.rainLayer.addChild(spr)
      const a = -Math.PI * 0.5 + (Math.random() - 0.5) * 1.6
      const spd = 40 + Math.random() * 100
      this.splashes.push({
        spr,
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 0.22 + Math.random() * 0.18,
        age: 0,
        sc0: sc,
      })
    }
  }

  spawnRipple(x, y, power = 0.5) {
    const spr = new PIXI.Sprite(this.rippleTex)
    spr.anchor.set(0.5)
    spr.x = x
    spr.y = y
    spr.scale.set(0.1, 0.05)
    this.rippleScene.addChild(spr)
    this.ripples.push({
      spr,
      r0: 5,
      rGrow: 26 + power * 55,
      life: 0.6 + power * 0.5,
      age: 0,
      power: 0.5 + power * 0.5,
    })
  }
}

// ─────────────────────────────────────────────
// 道具 / 角色
// ─────────────────────────────────────────────
function buildProps(mapInfo) {
  const { ox, oy, TH, TW } = mapInfo
  // 站位贴着几个大水坑上沿，让倒影落进水面
  const list = [
    { x: ox - TW * 0.25, y: oy - TH * 3.1, kind: 'pillar', h: 96 },
    { x: ox - TW * 1.3, y: oy - TH * 0.6, kind: 'crystal', h: 60 },
    { x: ox + TW * 1.0, y: oy + TH * 2.6, kind: 'pillar', h: 76 },
    { x: ox + TW * 1.9, y: oy - TH * 1.2, kind: 'rock', h: 40 },
    { x: ox - TW * 2.7, y: oy + TH * 1.4, kind: 'rock', h: 34 },
    { x: ox + TW * 2.3, y: oy - TH * 2.6, kind: 'crystal', h: 46 },
    { x: ox - TW * 3.0, y: oy - TH * 0.9, kind: 'pillar', h: 84 },
  ]
  return list.map((d) => {
    const view = new PIXI.Container()
    view.x = d.x
    view.y = d.y
    const g = new PIXI.Graphics()
    if (d.kind === 'pillar') {
      g.beginFill(0x3a342e)
      g.drawRoundedRect(-10, -d.h, 20, d.h, 4)
      g.endFill()
      g.beginFill(0x5a4a38)
      g.drawEllipse(0, -d.h, 14, 6)
      g.endFill()
      g.beginFill(0x1a1410, 0.35)
      g.drawEllipse(0, 2, 16, 6)
      g.endFill()
    } else if (d.kind === 'crystal') {
      g.beginFill(0x6a80c0, 0.85)
      g.moveTo(0, -d.h)
      g.lineTo(12, -d.h * 0.35)
      g.lineTo(0, 0)
      g.lineTo(-12, -d.h * 0.35)
      g.closePath()
      g.endFill()
      g.beginFill(0xc0d0ff, 0.45)
      g.moveTo(0, -d.h)
      g.lineTo(5, -d.h * 0.5)
      g.lineTo(0, -d.h * 0.3)
      g.closePath()
      g.endFill()
    } else {
      g.beginFill(0x4a4238)
      g.drawEllipse(0, -12, 22, 16)
      g.endFill()
      g.beginFill(0x2a2622)
      g.drawEllipse(-6, -18, 10, 8)
      g.endFill()
      g.beginFill(0x1a1410, 0.35)
      g.drawEllipse(0, 2, 20, 7)
      g.endFill()
    }
    view.addChild(g)
    return { view, gfx: g, ...d }
  })
}

function createHero(x, y) {
  const view = new PIXI.Container()
  view.x = x
  view.y = y
  const shadow = new PIXI.Graphics()
  shadow.beginFill(0x000000, 0.35)
  shadow.drawEllipse(0, 2, 16, 6)
  shadow.endFill()
  const body = new PIXI.Graphics()
  body.beginFill(0xf0e6d8)
  body.drawRoundedRect(-10, -36, 20, 36, 6)
  body.endFill()
  body.beginFill(0x2a2030)
  body.drawCircle(0, -44, 10)
  body.endFill()
  view.addChild(shadow, body)
  return { view, body, x, y }
}

// ─────────────────────────────────────────────
// 纹理生成
// ─────────────────────────────────────────────
/**
 * 造波噪声：R = 4 октave 平铺 fbm（积水形状），G/B = 独立噪声（扰动/扫波）
 * CPU 保留 R 通道数据，保证 isOnPuddle 与 shader 判定一致
 */
function makeWaveNoise(size) {
  const rand = mulberry32(1337)
  const octaves = [
    { freq: 4, amp: 1.0 },
    { freq: 8, amp: 0.5 },
    { freq: 16, amp: 0.25 },
    { freq: 32, amp: 0.125 },
  ]
  const grids = octaves.map((o) => {
    const g = new Float32Array(o.freq * o.freq)
    for (let i = 0; i < g.length; i++) g[i] = rand()
    return g
  })
  const sampleOct = (u, v, oct, grid) => {
    const f = oct.freq
    const x = ((u % 1) + 1) % 1 * f
    const y = ((v % 1) + 1) % 1 * f
    const x0 = Math.floor(x) % f
    const y0 = Math.floor(y) % f
    const x1 = (x0 + 1) % f
    const y1 = (y0 + 1) % f
    const fx = smooth(x - Math.floor(x))
    const fy = smooth(y - Math.floor(y))
    const a = grid[y0 * f + x0]
    const b = grid[y0 * f + x1]
    const c = grid[y1 * f + x0]
    const d = grid[y1 * f + x1]
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)
  }
  const fbm = (u, v) => {
    let s = 0
    let norm = 0
    for (let i = 0; i < octaves.length; i++) {
      s += sampleOct(u, v, octaves[i], grids[i]) * octaves[i].amp
      norm += octaves[i].amp
    }
    return s / norm
  }

  // 归一化到 0..1
  const dataR = new Float32Array(size * size)
  let mn = 1
  let mx = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = fbm(x / size, y / size)
      dataR[y * size + x] = v
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
  }
  const inv = 1 / (mx - mn)
  for (let i = 0; i < dataR.length; i++) dataR[i] = (dataR[i] - mn) * inv

  // 辅助噪声（G/B），相位错开
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      img.data[i] = dataR[y * size + x] * 255
      img.data[i + 1] = fbm((x / size + 0.37) % 1, (y / size + 0.71) % 1) * 255
      img.data[i + 2] = fbm((x / size + 0.64) % 1, (y / size + 0.18) % 1) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const texture = PIXI.Texture.from(c)
  texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT
  texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF

  // CPU 双线性采样（与 GPU linear+repeat 一致）
  const sampleR = (u, v) => {
    const x = (((u % 1) + 1) % 1) * size - 0.5
    const y = (((v % 1) + 1) % 1) * size - 0.5
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const xi0 = ((x0 % size) + size) % size
    const yi0 = ((y0 % size) + size) % size
    const xi1 = (xi0 + 1) % size
    const yi1 = (yi0 + 1) % size
    const a = dataR[yi0 * size + xi0]
    const b = dataR[yi0 * size + xi1]
    const cc = dataR[yi1 * size + xi0]
    const d = dataR[yi1 * size + xi1]
    return lerp(lerp(a, b, fx), lerp(cc, d, fx), fy)
  }
  return { texture, sampleR }
}

/**
 * 波纹环纹理：r=1（波强/白沫），gb=径向方向编码（0.5 为中性），alpha=环形轮廓
 * 对应教程"红色水波纹 + 绿蓝通道水波纹"合成一张
 */
function makeRippleTexture(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const cx = size / 2
  const R0 = size * 0.32
  const sigma = size * 0.05
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cx
      const d = Math.hypot(dx, dy) || 1
      const p = Math.exp(-((d - R0) * (d - R0)) / (sigma * sigma))
      const i = (y * size + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 128 + (dx / d) * 120
      img.data[i + 2] = 128 + (dy / d) * 120
      img.data[i + 3] = Math.min(255, p * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = PIXI.Texture.from(c)
  tex.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF
  return tex
}

/** 倒影 RT 的天空底：上暗下亮的阴雨天渐变 */
function makeSkySprite() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 256
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#141c28')
  g.addColorStop(0.55, '#1e2c3e')
  g.addColorStop(1, '#32485e')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 256)
  // 几条云带
  ctx.fillStyle = 'rgba(70,95,120,0.16)'
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    ctx.ellipse(32, 50 + i * 42, 40, 8, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  const spr = new PIXI.Sprite(PIXI.Texture.from(c))
  spr.width = W
  spr.height = H
  return spr
}

function makeDropTexture() {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 24
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 24)
  g.addColorStop(0, 'rgba(200,230,255,0)')
  g.addColorStop(0.4, 'rgba(200,230,255,0.7)')
  g.addColorStop(1, 'rgba(200,230,255,0.15)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(4, 0)
  ctx.quadraticCurveTo(8, 12, 4, 24)
  ctx.quadraticCurveTo(0, 12, 4, 0)
  ctx.fill()
  return PIXI.Texture.from(c)
}

function makeSplashTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgba(220,240,255,0.9)'
  ctx.beginPath()
  ctx.arc(8, 8, 5, 0, Math.PI * 2)
  ctx.fill()
  return PIXI.Texture.from(c)
}

// ─────────────────────────────────────────────
// 音频
// ─────────────────────────────────────────────
class RainAudio {
  constructor() {
    this.ctx = null
    this._rainNodes = null
  }
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!this.ctx) this.ctx = new AC()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }
  startRainLoop() {
    this.unlock()
    if (!this.ctx || this._rainNodes) return
    const ctx = this.ctx
    const sr = ctx.sampleRate
    const n = sr * 2
    const buf = ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 4200
    bp.Q.value = 0.6
    const g = ctx.createGain()
    g.gain.value = 0.12
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start()
    this._rainNodes = { src, g }
  }
  stopRainLoop() {
    if (!this._rainNodes) return
    try {
      this._rainNodes.src.stop()
    } catch (e) {
      void e
    }
    this._rainNodes = null
  }
  playWetStep() {
    this.unlock()
    if (!this.ctx) return
    const ctx = this.ctx
    const t0 = ctx.currentTime
    const sr = ctx.sampleRate
    const n = Math.floor(sr * 0.12)
    const buf = ctx.createBuffer(1, n, sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) {
      const e = 1 - i / n
      data[i] = (Math.random() * 2 - 1) * e * e
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'lowpass'
    bp.frequency.value = 900
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.22, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12)
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start(t0)
  }
}

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}
function lerp(a, b, t) {
  return a + (b - a) * t
}
function smooth(t) {
  return t * t * (3 - 2 * t)
}
function smoothstep01(t) {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

main().catch((err) => {
  console.error(err)
  const hud = document.getElementById('hud')
  if (hud) hud.innerHTML = `<b style="color:#e07070">Demo 启动失败</b><br/>${err?.message || err}`
})
