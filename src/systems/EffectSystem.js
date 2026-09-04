import { RES } from '../config.js'
import { loadPixiSpine, getSpineClass, pickAnim, listAnims } from '../utils/loadPixiSpine.js'
import { seffectAt, seffectRandom, SEFFECT_INDEX } from '../data/seffectIndex.js'
import { SKILL_SEEDS, SKILL_SFX } from '../director/skills.js'
import { isBasicFx, playBasicFx } from '../fx/basicParticles.js'

/**
 * 技能特效
 * - 射线 / 魔法弹等：基础粒子（basicParticles），不走 seffect
 * - 其余：seffect Spine
 * 作用对象：at / from→to projectile / mid
 */
export class EffectSystem {
  constructor(game) {
    this.game = game
    this.root = game.fxLayer
    this._cache = new Map()
    this._spineReady = null
  }

  async _ensureSpine() {
    if (!this._spineReady) this._spineReady = loadPixiSpine()
    await this._spineReady
  }

  update(dt) {
    for (const child of this.root.children) {
      if (child.update) child.update(dt)
    }
  }

  /**
   * @param {string} [fxId] seffect 文件夹名 / 逻辑技能名；空则随机
   * @param {object} [opts]
   */
  async play(fxId, opts = {}) {
    const skillKey = fxId && (SKILL_SEEDS[fxId] != null || isBasicFx(fxId)) ? fxId : null
    const mode = opts.mode || inferMode(opts)
    const pos = resolveFxPos(this.game, opts, mode)

    // 技能特效附带音效（元素属性）；射线音跟飞行时长走，才有持续呲呲
    if (opts.silent !== true) {
      const sfx = opts.sfx || (skillKey && SKILL_SFX[skillKey]) || null
      const sfxMs =
        opts.sfxMs != null
          ? opts.sfxMs
          : mode === 'projectile' && (sfx === 'electric' || skillKey === 'color_ray' || skillKey === 'decay_ray')
            ? (opts.travelMs != null ? opts.travelMs : 380) + 60
            : opts.ms
      this.game.sound?.playForSkill?.(skillKey, { ...opts, sfx, ms: sfxMs })
    }

    // 射线 / 弹道：基础粒子（命中圈 = 受击者身高一半）
    if (skillKey && isBasicFx(skillKey)) {
      console.info('[FX] basic', skillKey, '→', mode, pos.label)
      const victim =
        mode === 'projectile' && opts.to && opts.hitFeedback !== false ? opts.to : null
      return playBasicFx(this.root, skillKey, pos, {
        ...opts,
        game: this.game,
        bodyH: actorDisplayH(this.game, opts.to || opts.at || opts.from),
        onHit: victim
          ? () => this.game.chars?.playHit?.(victim, { ms: 200, shake: 8 })
          : opts.onHit,
      })
    }

    await this._ensureSpine()
    const seed = opts.seed ?? (skillKey ? SKILL_SEEDS[skillKey] : Date.now())
    const id = (fxId && !skillKey ? fxId : null) || seffectRandom(seed)
    if (!id) {
      console.warn('[FX] no seffect list')
      return false
    }

    const spineData = await this._load(id)
    const Spine = getSpineClass()
    if (!spineData || !Spine) {
      console.warn('[FX] load fail', id)
      return false
    }

    const spine = new Spine(spineData)
    spine.autoUpdate = false
    const scale = opts.scale ?? 0.5
    spine.scale.set(scale)
    spine.x = pos.x
    spine.y = pos.y

    this.root.addChild(spine)
    const anim =
      pickAnim(spine, ['animation_0', 'animation', 'idle', 'skill', 'effect']) ||
      listAnims(spine)[0]
    if (anim && spine.state) {
      spine.state.setAnimation(0, anim, !!opts.loop)
      console.info('[FX]', skillKey || id, '→', mode, pos.label, 'anim=', anim)
    }

    const travel = opts.travelMs ?? (mode === 'projectile' ? 380 : 0)
    const hold = opts.ms ?? (mode === 'projectile' ? 700 : 1000)

    if (mode === 'projectile' && pos.toX != null) {
      await tweenPos(spine, pos.x, pos.y, pos.toX, pos.toY, travel)
    }

    await sleep(hold)
    if (spine.parent) spine.parent.removeChild(spine)
    try {
      spine.destroy({ children: true })
    } catch (e) {
      void e
    }
    return true
  }

  async playAt(index, opts = {}) {
    if (index == null || index < 0) return this.play(null, opts)
    return this.play(seffectAt(index), opts)
  }

  listCount() {
    return SEFFECT_INDEX.length
  }

  _load(folder) {
    if (this._cache.has(folder)) return Promise.resolve(this._cache.get(folder))
    const base = `${RES.jineng}/seffect/${folder}/${folder}`
    const jsonUrl = `${base}.json`
    const key = `fx_${folder}`

    return new Promise((resolve) => {
      const loader = new PIXI.Loader()
      loader.add(key, jsonUrl).load((_, resources) => {
        const data = resources[key]?.spineData || null
        if (data) this._cache.set(folder, data)
        resolve(data)
      })
      loader.onError.add((err) => {
        console.warn('[FX] loader error', folder, err?.message || err)
        resolve(null)
      })
    })
  }
}

function inferMode(opts) {
  if (opts.at) return 'at'
  if (opts.from && opts.to) return opts.mode || 'projectile'
  if (opts.to) return 'to'
  if (opts.from) return 'from'
  return 'at'
}

/** 角色当前屏幕显示身高（px），特效圆圈跟这个比例走 */
function actorDisplayH(game, id) {
  const a = id ? game.chars?.get(id) : null
  if (!a?.spine || !(a.nativeH > 0)) {
    const form = game.map?.stageCfg?.formation
    const ratio = form?.humanRatio != null ? form.humanRatio : 0.14
    return 1080 * ratio
  }
  const unit = a.unitScale != null ? a.unitScale : 0.3
  const size = a.size != null ? a.size : 1
  const buff = a.buffMul != null ? a.buffMul : 1
  const depth = a.depthScale != null ? a.depthScale : 1
  return Math.max(40, unit * size * buff * depth * a.nativeH)
}

function actorXY(game, id) {
  const a = game.chars?.get(id)
  if (!a?.view || !a.visible) return null
  // 胸口高度：随体型，约 -0.55×显示身高
  const h = actorDisplayH(game, id) * 0.55
  const yOff = -Math.min(140, Math.max(55, h))
  return { x: a.view.x, y: a.view.y + yOff, id }
}

function resolveFxPos(game, opts, mode) {
  const camX = game.camera?.x ?? 960
  const camY = (game.camera?.y ?? 540) - 40
  const from = opts.from ? actorXY(game, opts.from) : null
  const to = opts.to ? actorXY(game, opts.to) : null
  const at = opts.at ? actorXY(game, opts.at) : null

  if (mode === 'mid' && from && to) {
    return {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      label: `mid(${opts.from},${opts.to})`,
    }
  }
  if (mode === 'projectile' && from && to) {
    return {
      x: from.x,
      y: from.y,
      toX: to.x,
      toY: to.y,
      label: `${opts.from}→${opts.to}`,
    }
  }
  if (mode === 'at' && at) return { x: at.x, y: at.y, label: `at:${opts.at}` }
  if (mode === 'to' && to) return { x: to.x, y: to.y, label: `to:${opts.to}` }
  if (mode === 'from' && from) return { x: from.x, y: from.y, label: `from:${opts.from}` }
  if (at) return { x: at.x, y: at.y, label: `at:${opts.at}` }
  if (to) return { x: to.x, y: to.y, label: `to:${opts.to}` }
  if (from) return { x: from.x, y: from.y, label: `from:${opts.from}` }
  return { x: opts.x ?? camX, y: opts.y ?? camY, label: 'cam' }
}

function tweenPos(display, x0, y0, x1, y1, ms) {
  if (ms <= 0) {
    display.x = x1
    display.y = y1
    return Promise.resolve()
  }
  const start = performance.now()
  return new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ms)
      const e = t * (2 - t)
      display.x = x0 + (x1 - x0) * e
      // 轻微抛物线，读得出「打过去」
      display.y = y0 + (y1 - y0) * e - Math.sin(Math.PI * t) * 40
      if (t < 1) requestAnimationFrame(tick)
      else {
        display.x = x1
        display.y = y1
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
