import { BEATS, isLead } from '../director/formations.js'
import { PositionDirector } from '../director/PositionDirector.js'
import { ActionDirector } from '../director/ActionDirector.js'
import { EffectDirector } from '../director/EffectDirector.js'

/**
 * 总导演（调度门面）
 *
 * - position  位置导演：阵型 / 入场 / 行军 / 站位
 * - action    动作导演：突进 / 对砍 / 击退 / 围攻…
 * - effect    特效导演：技能落点 / 射线弹道 / 命中
 *
 * 剧本 `direct` 仍走本门面；也可 `game.director.position|action|effect`
 */
export class DirectorSystem {
  constructor(game) {
    this.game = game
    this.position = new PositionDirector(game)
    this.effect = new EffectDirector(game)
    this.action = new ActionDirector(
      game,
      () => this.effect,
      () => this.position
    )
  }

  // ── 镜头纪律（跨导演共享）──

  async maybeFocusSpeaker(who, opts = {}) {
    if (!isLead(who)) return
    await this.game.camera.focus(who, {
      zoom: opts.zoom != null ? opts.zoom : 1.03,
      ms: opts.ms != null ? opts.ms : 700,
      force: true,
    })
  }

  async beat(name, opts = {}) {
    const b = BEATS[name]
    if (!b) {
      console.warn('[Director] unknown beat', name)
      return
    }
    const cam = { ...(b.camera || {}), ...opts }
    await this._applyCamera(cam)
  }

  async _applyCamera(cam) {
    const camera = this.game.camera
    if (!camera || !cam) return
    camera.unlock()
    if (cam.follow && cam.ids) {
      camera.follow(cam.ids, { zoom: cam.zoom, force: true })
      return
    }
    if (cam.focus) {
      await camera.focus(cam.focus, { zoom: cam.zoom, ms: cam.ms, y: cam.y, force: true })
      return
    }
    if (cam.group) {
      await camera.focusGroup(cam.group, { zoom: cam.zoom, ms: cam.ms, force: true })
      return
    }
    await camera.panTo({
      x: cam.x,
      y: cam.y,
      zoom: cam.zoom,
      ms: cam.ms != null ? cam.ms : 0,
      force: true,
    })
  }

  // ── 位置导演委托 ──

  resolveFormation(...a) {
    return this.position.resolveFormation(...a)
  }
  enterFormation(...a) {
    return this.position.enterFormation(...a)
  }
  holdFormation(...a) {
    return this.position.holdFormation(...a)
  }
  march(...a) {
    return this.position.march(...a)
  }
  unclump(...a) {
    return this.position.unclump(...a)
  }
  /** @deprecated 用 unclump */
  _unclump(...a) {
    return this.position.unclump(...a)
  }
  enter(...a) {
    return this.position.enter(...a)
  }
  exit(...a) {
    return this.position.exit(...a)
  }
  faceAll(...a) {
    return this.position.faceAll(...a)
  }
  rest(...a) {
    return this.position.rest(...a)
  }
  returnHome(...a) {
    return this.position.returnHome(...a)
  }
  resetFormation(...a) {
    return this.position.resetFormation(...a)
  }
  groundY() {
    return this.position.groundY()
  }

  // ── 动作导演委托 ──

  lunge(...a) {
    return this.action.lunge(...a)
  }
  clash(...a) {
    return this.action.clash(...a)
  }
  knockback(...a) {
    return this.action.knockback(...a)
  }
  rush(...a) {
    return this.action.rush(...a)
  }
  freeze(...a) {
    return this.action.freeze(...a)
  }
  buffScale(...a) {
    return this.action.buffScale(...a)
  }
  dashThrough(...a) {
    return this.action.dashThrough(...a)
  }
  stepBack(...a) {
    return this.action.stepBack(...a)
  }
  knockdown(...a) {
    return this.action.knockdown(...a)
  }

  // ── 特效导演委托 ──

  playFx(...a) {
    return this.effect.play(...a)
  }
}
