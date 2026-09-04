import * as PIXI from 'pixi.js'
import {
  CAST,
  RES,
  DEFAULT_SLOTS,
  ANIM_ALIASES,
  bodySizeOf,
  humanHeightPx,
} from '../config.js'
import { loadPixiSpine, getSpineClass, pickAnim, listAnims } from '../utils/loadPixiSpine.js'
import { measureSpineNativeHeight, unitScaleFromNative } from '../utils/spineSize.js'

/**
 * 角色系统
 * 站位 / 朝向 / 出场退场 —— 见 docs/演出规划_v1.md
 */
export class CharacterSystem {
  constructor(game) {
    this.game = game
    this.root = game.charLayer
    this.actors = new Map()
    this._spineReady = null
  }

  async _ensureSpine() {
    if (!this._spineReady) this._spineReady = loadPixiSpine()
    await this._spineReady
  }

  update(dt) {
    for (const actor of this.actors.values()) {
      if (!actor.visible || !actor.spine) continue
      if (actor.spine.update) actor.spine.update(dt)
    }
    this.sortByDepth()
  }

  /** 2.5D：脚下 y 越大越靠前，遮挡后方 */
  sortByDepth() {
    const list = []
    for (const actor of this.actors.values()) {
      if (!actor.view?.parent) continue
      list.push(actor)
    }
    list.sort((a, b) => a.view.y - b.view.y)
    for (let i = 0; i < list.length; i++) {
      this.root.setChildIndex(list[i].view, i)
    }
  }

  setDepth(id, depth, depthScale) {
    const actor = this.actors.get(id)
    if (!actor) return
    if (depth != null) actor.depth = depth
    if (depthScale != null) actor.depthScale = depthScale
    else if (depth != null) actor.depthScale = 1 + depth * 0.07
    this.setFace(id, actor.face || 'right')
  }

  get(id) {
    return this.actors.get(id) || null
  }

  /** 预创建角色（不显示），开场加载用 */
  async preload(id) {
    await this._ensureSpine()
    if (this.actors.has(id)) return this.actors.get(id)
    const actor = await this._create(id)
    actor.visible = false
    actor.view.visible = false
    this.actors.set(id, actor)
    this.root.addChild(actor.view)
    return actor
  }

  async preloadMany(ids, onProgress) {
    await this._ensureSpine()
    for (let i = 0; i < ids.length; i++) {
      await this.preload(ids[i])
      onProgress?.(i + 1, ids.length, ids[i])
    }
  }

  /**
   * @param {object} opts
   * @param {string} [opts.slot]
   * @param {'left'|'right'} [opts.face]
   * @param {'fade'|'walk'|'jump'|'instant'} [opts.enter]
   * @param {string} [opts.from]
   */
  async show(id, opts = {}) {
    await this._ensureSpine()
    const slot = opts.slot || 'center'
    const enter = opts.enter || 'fade'
    const from = opts.from || (enter === 'walk' ? inferOffSlot(slot) : slot)

    let actor = this.actors.get(id)
    if (!actor) {
      actor = await this._create(id)
      this.actors.set(id, actor)
      this.root.addChild(actor.view)
    }

    actor.visible = true
    actor.view.visible = true
    actor.view.alpha = 1

    const face = opts.face || defaultFaceForSlot(slot)
    this.setFace(id, face)

    if (enter === 'walk') {
      this._place(id, from)
      this.setFace(id, faceToward(from, slot))
      this.playAnim(id, 'walk', true)
      await this._tweenToSlot(id, slot, 900)
      this.move(id, slot)
      this.setFace(id, face)
      this.playAnim(id, 'idle', true)
    } else if (enter === 'jump') {
      this._place(id, from)
      this.playAnim(id, 'jump', false)
      await this._tweenToSlot(id, slot, 550, true)
      this.move(id, slot)
      this.setFace(id, face)
      this.playAnim(id, 'idle', true)
    } else if (enter === 'fade') {
      this.move(id, slot)
      actor.view.alpha = 0
      this.playAnim(id, 'idle', true)
      await tweenAlpha(actor.view, 1, 320)
    } else {
      this.move(id, slot)
      this.playAnim(id, 'idle', true)
    }

    this.setHighlight(id, true)
    return actor
  }

  /**
   * @param {object} [opts]
   * @param {'fade'|'walk'|'instant'} [opts.exit]
   * @param {string} [opts.to]
   */
  async hide(id, opts = {}) {
    const actor = this.actors.get(id)
    if (!actor || !actor.visible) return
    const exit = opts.exit || 'fade'
    const to = opts.to || 'hide'

    if (exit === 'walk') {
      this.playAnim(id, 'walk', true)
      await this._tweenToSlot(id, to, 700)
      this.playAnim(id, 'idle', true)
    } else if (exit === 'fade') {
      await tweenAlpha(actor.view, 0, 280)
    } else if (exit === 'instant') {
      actor.view.alpha = 0
    }

    actor.visible = false
    actor.view.visible = false
    actor.slot = to
    this.setHighlight(id, false)
  }

  /** 瞬间收起全部可见角色（切章用） */
  async hideAll(opts = {}) {
    const ids = [...this.actors.keys()].filter((id) => this.get(id)?.visible)
    await Promise.all(ids.map((id) => this.hide(id, { exit: opts.exit || 'instant' })))
    this.clearFocus()
    this.hideBubbleSafe()
  }

  hideBubbleSafe() {
    try {
      this.game.dialogue?.hideBubble?.()
    } catch (e) {
      void e
    }
  }

  move(id, slot) {
    this._place(id, slot)
  }

  _place(id, slot) {
    const actor = this.actors.get(id)
    if (!actor) return
    const pos = this.game.map.getSpawn(slot) || DEFAULT_SLOTS[slot] || DEFAULT_SLOTS.center
    actor.slot = slot
    actor.view.x = pos.x
    actor.view.y = pos.y
  }

  /** 导演：放到世界坐标（不经 slot） */
  placeAt(id, x, y, slotLabel = 'world') {
    const actor = this.actors.get(id)
    if (!actor) return
    actor.slot = slotLabel
    actor.view.x = x
    actor.view.y = y
  }

  async ensureActor(id) {
    await this._ensureSpine()
    let actor = this.actors.get(id)
    if (!actor) {
      actor = await this._create(id)
      this.actors.set(id, actor)
      this.root.addChild(actor.view)
    }
    return actor
  }

  /** 导演：世界坐标出场 */
  async showAt(id, opts = {}) {
    const actor = await this.ensureActor(id)
    actor.visible = true
    actor.view.visible = true
    actor.view.alpha = 1
    this.placeAt(id, opts.x, opts.y)
    if (opts.depth != null || opts.depthScale != null) {
      this.setDepth(id, opts.depth, opts.depthScale)
    }
    if (opts.face) this.setFace(id, opts.face)
    else this.setFace(id, actor.face || 'right')
    const enter = opts.enter || 'instant'
    if (enter === 'fade') {
      actor.view.alpha = 0
      this.playAnim(id, 'idle', true)
      await tweenAlpha(actor.view, 1, 320)
    } else {
      this.playAnim(id, 'idle', true)
    }
    this.setHighlight(id, true)
    return actor
  }

  /** 导演：从画外走到世界坐标 */
  async walkIn(id, opts = {}) {
    const actor = await this.ensureActor(id)
    actor.visible = true
    actor.view.visible = true
    actor.view.alpha = 1
    const from = opts.from || { x: -200, y: opts.to?.y || 920 }
    const to = opts.to || { x: 960, y: 920 }
    this.placeAt(id, from.x, from.y)
    if (opts.depth != null || opts.depthScale != null) {
      this.setDepth(id, opts.depth, opts.depthScale)
    }
    const face = opts.face || (to.x >= from.x ? 'right' : 'left')
    this.setFace(id, to.x >= from.x ? 'right' : 'left')
    this.playAnim(id, 'walk', true)
    await this.tweenTo(id, { x: to.x, y: to.y, ms: opts.ms || 900 })
    this.setFace(id, face)
    this.playAnim(id, 'idle', true)
    this.setHighlight(id, true)
    return actor
  }

  /** 世界坐标缓动（保持队形行军用） */
  async tweenTo(id, opts = {}) {
    const actor = this.actors.get(id)
    if (!actor) return
    const toX = opts.x
    const toY = opts.y != null ? opts.y : actor.view.y
    const ms = opts.ms || 800
    const arc = !!opts.arc
    const fromX = actor.view.x
    const fromY = actor.view.y
    const start = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / ms)
        const e = easeInOut(t)
        actor.view.x = fromX + (toX - fromX) * e
        const yLinear = fromY + (toY - fromY) * e
        actor.view.y = arc ? yLinear - Math.sin(Math.PI * t) * 80 : yLinear
        if (t < 1) requestAnimationFrame(tick)
        else {
          actor.view.x = toX
          actor.view.y = toY
          resolve()
        }
      }
      requestAnimationFrame(tick)
    })
  }

  _targetHumanH() {
    return humanHeightPx(this.game.map?.stageCfg?.formation || null)
  }

  /** 切地图后：原生体高不变，目标身高跟当前舞台世界比例 */
  resyncWorldScale() {
    const targetH = this._targetHumanH()
    for (const actor of this.actors.values()) {
      if (!actor.spine || !(actor.nativeH > 0)) continue
      actor.unitScale = unitScaleFromNative(actor.nativeH, targetH, actor.cast?.nativeH)
      actor.baseScale = actor.unitScale * (actor.size != null ? actor.size : 1)
      this.setFace(actor.id, actor.face || 'right')
    }
  }

  setFace(id, face) {
    const actor = this.actors.get(id)
    if (!actor) return
    actor.face = face === 'left' ? 'left' : 'right'
    const targetH = this._targetHumanH()
    if (actor.nativeH > 0) {
      actor.unitScale = unitScaleFromNative(actor.nativeH, targetH, actor.cast?.nativeH)
    }
    const size = actor.size != null ? actor.size : bodySizeOf(id)
    const unit = actor.unitScale != null ? actor.unitScale : targetH / 500
    const buff = actor.buffMul != null ? actor.buffMul : 1
    const depthMul = actor.depthScale != null ? actor.depthScale : 1
    if (actor.spine) {
      const nativeLeft = actor.cast.nativeFace !== 'right'
      const wantLeft = actor.face === 'left'
      const sign = wantLeft === nativeLeft ? 1 : -1
      const s = unit * size * buff * depthMul
      actor.spine.scale.x = sign * s
      actor.spine.scale.y = s
    }
  }

  /** 说话时转向目标；无目标则保持 */
  faceTowardActor(id, targetId) {
    const a = this.actors.get(id)
    const b = this.actors.get(targetId)
    if (!a || !b || !b.visible) return
    this.setFace(id, a.view.x <= b.view.x ? 'right' : 'left')
  }

  anim(id, name) {
    this.playAnim(id, name || 'jump', false)
    const actor = this.actors.get(id)
    if (!actor) return
    setTimeout(() => {
      if (actor.visible) this.playAnim(id, 'idle', true)
    }, 900)
  }

  playAnim(id, aliasOrName, loop = true) {
    const actor = this.actors.get(id)
    if (!actor || !actor.spine) return
    const allowDeath = aliasOrName === 'die'
    const candidates = ANIM_ALIASES[aliasOrName] || [aliasOrName]
    const name = pickAnim(actor.spine, candidates, { allowDeath })
    if (!name) return
    try {
      actor.spine.state.setAnimation(0, name, loop)
      actor.currentAnim = name
    } catch (e) {
      console.warn('[Character] anim fail', id, name, e)
    }
  }

  /**
   * 受击反馈：闪白/红 + 微抖（许多 Spine 无独立 hit 动作时也能看出打中）
   */
  flashHit(id, opts = {}) {
    const actor = this.actors.get(id)
    if (!actor?.visible || !actor.spine) return
    const ms = opts.ms != null ? opts.ms : 220
    const tint = opts.tint != null ? opts.tint : 0xff6688
    const shake = opts.shake != null ? opts.shake : 10
    const spine = actor.spine
    const view = actor.view
    const baseX = view.x
    const prevTint = spine.tint != null ? spine.tint : 0xffffff
    if (actor._hitFlash) {
      cancelAnimationFrame(actor._hitFlash)
      actor._hitFlash = 0
      spine.tint = actor._hitTintPrev != null ? actor._hitTintPrev : 0xffffff
      if (actor._hitBaseX != null) view.x = actor._hitBaseX
    }
    actor._hitTintPrev = prevTint
    actor._hitBaseX = baseX
    const baseAlpha = spine.alpha != null ? spine.alpha : 1
    spine.tint = tint
    const start = performance.now()
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ms)
      const kick = Math.sin(t * Math.PI) * shake * (1 - t)
      const dir = actor.face === 'left' ? 1 : -1
      view.x = baseX + dir * kick
      // 前半红白闪 + 亮度跳，后半回到原色（无 hit 动作时也能看出挨打）
      if (t < 0.45) {
        spine.tint = t < 0.22 ? 0xffffff : tint
        spine.alpha = baseAlpha * (t < 0.22 ? 1 : 0.72)
      } else {
        const u = (t - 0.45) / 0.55
        spine.tint = lerpTint(tint, prevTint, u)
        spine.alpha = baseAlpha * (0.72 + 0.28 * u)
      }
      if (t < 1) {
        actor._hitFlash = requestAnimationFrame(tick)
      } else {
        spine.tint = prevTint
        spine.alpha = baseAlpha
        view.x = baseX
        actor._hitFlash = 0
        actor._hitTintPrev = null
        actor._hitBaseX = null
      }
    }
    actor._hitFlash = requestAnimationFrame(tick)
  }

  /** 受击：动画 + 可视反馈 */
  playHit(id, opts = {}) {
    this.playAnim(id, 'hit', false)
    this.flashHit(id, opts)
  }

  focusSpeaker(who) {
    for (const [id, actor] of this.actors) {
      if (!actor.visible) continue
      const on = !!(who && id === who)
      actor.talking = on
      this.setHighlight(id, on)
      if (on) this.playAnim(id, 'talk', true)
      else this.playAnim(id, 'idle', true)
    }
  }

  clearFocus() {
    for (const [id, actor] of this.actors) {
      actor.talking = false
      if (actor.visible) {
        this.setHighlight(id, true)
        this.playAnim(id, 'idle', true)
      }
    }
  }

  setHighlight(id, on) {
    const actor = this.actors.get(id)
    if (!actor) return
    // 说话高亮时别把气泡父节点 alpha 一起弄乱——只压 spine
    if (actor.spine) actor.spine.alpha = on ? 1 : 0.4
    else actor.view.alpha = on ? 1 : 0.4
  }

  async _tweenToSlot(id, slot, ms, arc = false) {
    const actor = this.actors.get(id)
    if (!actor) return
    const to = this.game.map.getSpawn(slot) || DEFAULT_SLOTS[slot] || DEFAULT_SLOTS.center
    const fromX = actor.view.x
    const fromY = actor.view.y
    const start = performance.now()
    await new Promise((resolve) => {
      const tick = () => {
        const t = Math.min(1, (performance.now() - start) / ms)
        const e = easeInOut(t)
        actor.view.x = fromX + (to.x - fromX) * e
        const yLinear = fromY + (to.y - fromY) * e
        actor.view.y = arc ? yLinear - Math.sin(Math.PI * t) * 80 : yLinear
        if (t < 1) requestAnimationFrame(tick)
        else {
          actor.view.x = to.x
          actor.view.y = to.y
          resolve()
        }
      }
      requestAnimationFrame(tick)
    })
    actor.slot = slot
  }

  async _create(id) {
    const cast = CAST[id] || { folder: id, label: id, size: 1 }
    const view = new PIXI.Container()
    view.visible = false

    const size = bodySizeOf(id)
    const base = `${RES.juese}/${cast.folder}/${cast.folder}`
    const spineData = await this._loadSpineData(id, base)
    const Spine = getSpineClass()

    const targetH = this._targetHumanH()
    let spine = null
    let nativeH = targetH
    let unitScale = 1
    if (spineData && Spine) {
      spine = new Spine(spineData)
      spine.autoUpdate = false
      nativeH = measureSpineNativeHeight(spine, targetH)
      unitScale = unitScaleFromNative(nativeH, targetH, cast.nativeH)
      spine.scale.set(unitScale * size)
      view.addChild(spine)
      console.info(
        '[Character]',
        id,
        `nativeH=${nativeH.toFixed(0)}`,
        `worldH=${targetH.toFixed(0)}`,
        `unit=${unitScale.toFixed(3)}`,
        `size=${size}`,
        `→H≈${(targetH * size).toFixed(0)}`,
        'anims:',
        listAnims(spine).join(', ') || '(none)'
      )
    } else {
      console.warn('[Character] spine fail, placeholder', id)
      const g = new PIXI.Graphics()
      g.beginFill(0x6a7a90)
      g.drawCircle(0, -targetH * 0.35 * size, targetH * 0.28 * size)
      g.endFill()
      view.addChild(g)
    }

    return {
      id,
      cast,
      view,
      spine,
      visible: false,
      talking: false,
      slot: 'center',
      face: 'right',
      size,
      nativeH,
      unitScale,
      baseScale: unitScale * size,
      buffMul: 1,
      depth: 0,
      depthScale: 1,
      currentAnim: null,
    }
  }

  _loadSpineData(id, baseWithoutExt) {
    const skel = `${baseWithoutExt}.skel`
    const json = `${baseWithoutExt}.json`
    const key = `spine_${id}_${Date.now()}`

    return new Promise((resolve) => {
      const tryLoad = (url) =>
        new Promise((res) => {
          const loader = new PIXI.Loader()
          loader.add(key, url).load((_, resources) => {
            const r = resources[key]
            res((r && r.spineData) || null)
          })
          loader.onError.add(() => res(null))
        })

      tryLoad(skel).then(async (data) => {
        if (data) return resolve(data)
        resolve(await tryLoad(json))
      })
    })
  }
}

function lerpTint(a, b, t) {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  const r = (ar + (br - ar) * t) | 0
  const g = (ag + (bg - ag) * t) | 0
  const bl = (ab + (bb - ab) * t) | 0
  return (r << 16) | (g << 8) | bl
}

function defaultFaceForSlot(slot) {
  if (
    slot === 'right' ||
    slot === 'far_right' ||
    slot === 'off_right' ||
    slot === 'party4' ||
    slot === 'party5' ||
    slot === 'party6'
  ) {
    return 'left'
  }
  return 'right'
}

function inferOffSlot(slot) {
  if (slot === 'right' || slot === 'far_right' || slot === 'party4' || slot === 'party5' || slot === 'party6') {
    return 'off_right'
  }
  return 'off_left'
}

function faceToward(fromSlot, toSlot) {
  const order = {
    off_left: 0,
    hide: 1,
    party1: 2,
    far_left: 2.5,
    party2: 3,
    left: 3.5,
    party3: 4,
    center: 5,
    party4: 6,
    right: 6.5,
    party5: 7,
    far_right: 7.5,
    party6: 8,
    off_right: 9,
  }
  const a = order[fromSlot] ?? 5
  const b = order[toSlot] ?? 5
  return a <= b ? 'right' : 'left'
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function tweenAlpha(display, to, ms) {
  const from = display.alpha
  const start = performance.now()
  return new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ms)
      display.alpha = from + (to - from) * easeInOut(t)
      if (t < 1) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
}
