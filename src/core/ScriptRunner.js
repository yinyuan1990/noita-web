/**
 * 剧本驱动
 * 高层：camera / direct / fade
 * 见 docs/演出规划_v1.md · 演出规划_ch2.md
 */
export class ScriptRunner {
  constructor(game) {
    this.game = game
    this.playing = false
    this.paused = false
    this.index = 0
    this._scriptLen = 0
    this._chapterLabel = ''
  }

  async run(script, { label = '' } = {}) {
    this.stop()
    this.playing = true
    this.paused = false
    this.index = 0
    this._scriptLen = script.length
    this._chapterLabel = label
    const hud = document.getElementById('hud-script')
    for (let i = 0; i < script.length; i++) {
      if (!this.playing) break
      await this._gate()
      if (!this.playing) break
      this.index = i
      const step = script[i]
      if (hud) {
        const tag = label ? `${label} · ` : ''
        hud.textContent = `${tag}${i + 1}/${script.length} · ${step.cmd}${step.action ? ':' + step.action : ''}`
      }
      await this._exec(step)
    }
    this.game.dialogue.hideAll()
    this.game.camera?.stopFollow()
    if (hud && this.playing) hud.textContent = label ? `${label} · DONE` : 'SCRIPT DONE'
    const finished = this.playing
    this.playing = false
    this.paused = false
    return finished
  }

  stop() {
    this.playing = false
    this.paused = false
  }

  setPaused(v) {
    this.paused = !!v
    const badge = document.getElementById('pause-badge')
    if (badge) badge.classList.toggle('show', this.paused && this.playing)
    const btn = document.getElementById('btn-pause')
    if (btn) btn.textContent = this.paused ? '继续' : '暂停'
  }

  togglePause() {
    if (!this.playing) return false
    this.setPaused(!this.paused)
    return this.paused
  }

  /** 暂停门闩：播完当前步之前可卡在这里 */
  async _gate() {
    while (this.playing && this.paused) {
      await rawSleep(40)
    }
  }

  async _sleep(ms) {
    const end = performance.now() + (ms || 0)
    while (performance.now() < end) {
      if (!this.playing) return
      await this._gate()
      if (!this.playing) return
      await rawSleep(40)
    }
  }

  async _exec(step) {
    const { cmd } = step
    const g = this.game
    switch (cmd) {
      case 'setMap':
        await g.map.load(step.map, { force: !!step.force })
        break

      case 'fade':
        await g.fade(step.to || 'black', step.ms || 500)
        break

      case 'camera':
        await this._camera(step)
        break

      case 'direct':
        await this._direct(step)
        break

      case 'show':
        await g.chars.show(step.id, {
          slot: step.slot || 'center',
          face: step.face,
          enter: step.enter || 'fade',
          from: step.from,
        })
        if (step.anim) g.chars.anim(step.id, step.anim)
        if (step.camera === 'focus') {
          await g.camera.focus(step.id, { zoom: step.zoom || 1.15, ms: 500 })
        }
        break

      case 'showGroup': {
        const list = step.actors || []
        await Promise.all(
          list.map((a) =>
            g.chars.show(a.id, {
              slot: a.slot || 'center',
              face: a.face,
              enter: a.enter || step.enter || 'walk',
              from: a.from,
            })
          )
        )
        break
      }

      case 'hide':
        await g.chars.hide(step.id, { exit: step.exit || 'fade', to: step.to })
        break

      case 'hideAll':
        await g.chars.hideAll({ exit: step.exit || 'fade' })
        break

      case 'move':
        if (step.enter === 'walk') {
          await g.chars.show(step.id, {
            slot: step.slot,
            face: step.face,
            enter: 'walk',
            from: step.from || g.chars.get(step.id)?.slot,
          })
        } else {
          g.chars.move(step.id, step.slot)
          if (step.face) g.chars.setFace(step.id, step.face)
        }
        break

      case 'face':
        if (step.target) g.chars.faceTowardActor(step.id, step.target)
        else if (step.face) g.chars.setFace(step.id, step.face)
        break

      case 'anim':
        g.chars.anim(step.id, step.anim)
        break

      case 'say': {
        const who = step.who
        const actor = g.chars.get(who)
        g.chars.focusSpeaker(who)
        if (step.faceTarget) g.chars.faceTowardActor(who, step.faceTarget)
        else if (step.face) g.chars.setFace(who, step.face)
        else {
          const other = [...g.chars.actors.keys()].find((id) => id !== who && g.chars.get(id)?.visible)
          if (other) g.chars.faceTowardActor(who, other)
        }
        if (step.camera === true && who) {
          await g.director.maybeFocusSpeaker(who, { zoom: step.zoom, ms: step.camMs })
        }
        await g.dialogue.say(actor, step.text || '', { sleep: (ms) => this._sleep(ms) })
        break
      }

      case 'narrate':
        g.chars.clearFocus()
        g.dialogue.hideBubble()
        await g.dialogue.narrate(step.text || '', { sleep: (ms) => this._sleep(ms) })
        break

      case 'wait':
        await this._sleep(step.ms || 500)
        break

      case 'fx':
        // 特效导演：落点 / 射线 / 命中
        await g.director.effect.play(step.id || step.fx || step.skill || null, {
          sfx: step.sfx,
          from: step.from,
          to: step.to,
          at: step.at,
          mode: step.mode,
          x: step.x,
          y: step.y,
          scale: step.scale,
          ms: step.ms,
          travelMs: step.travelMs,
          seed: step.seed,
          loop: step.loop,
        })
        break

      case 'focus':
        if (step.id) g.chars.focusSpeaker(step.id)
        else g.chars.clearFocus()
        break

      default:
        console.warn('[Script] unknown cmd', cmd, step)
    }
  }

  async _camera(step) {
    const cam = this.game.camera
    const action = step.action || 'pan'
    const x = resolveCamX(this.game, step.x)
    const y = step.y
    if (action === 'cut') {
      cam.unlock()
      cam.cut({ x, y, zoom: step.zoom })
    } else if (action === 'pan') {
      cam.unlock()
      await cam.panTo({ x, y, zoom: step.zoom, ms: step.ms, force: true })
    } else if (action === 'focus') {
      cam.unlock()
      await cam.focus(step.id || step.target, { zoom: step.zoom, ms: step.ms, y, force: true })
    } else if (action === 'focusGroup') {
      cam.unlock()
      await cam.focusGroup(step.ids || [], { zoom: step.zoom, ms: step.ms, force: true })
    } else if (action === 'follow') {
      cam.unlock()
      cam.follow(step.ids || [], { zoom: step.zoom, force: true })
    } else if (action === 'stopFollow') {
      cam.stopFollow()
    } else if (action === 'lock') {
      if (x != null || y != null || step.zoom != null) {
        await cam.panTo({ x, y, zoom: step.zoom, ms: step.ms || 600, force: true })
      }
      cam.lock({ x, y, zoom: step.zoom })
    } else if (action === 'unlock') {
      cam.unlock()
    } else if (action === 'shake') {
      await cam.shake(step.amount, step.ms, { force: !!step.force })
    } else {
      console.warn('[Script] unknown camera action', action)
    }
  }

  async _direct(step) {
    const d = this.game.director
    const pos = d.position
    const act = d.action
    const action = step.action

    // —— 位置导演 ——
    if (action === 'enterFormation') {
      await pos.enterFormation(step.formation, {
        enter: step.enter || 'walk',
        staggerMs: step.staggerMs,
        zoom: step.zoom,
        camera: step.camera,
        cx: step.cx,
        cy: step.cy,
      })
    } else if (action === 'march') {
      await pos.march(step.ids || [], {
        dir: step.dir || 'right',
        distance: step.distance,
        ms: step.ms,
        staggerMs: step.staggerMs,
        zoom: step.zoom,
        cameraFollow: step.cameraFollow,
      })
    } else if (action === 'holdFormation') {
      await pos.holdFormation(step.formation, {
        ms: step.ms,
        zoom: step.zoom,
        camera: step.camera,
        cx: step.cx,
        cy: step.cy,
        keepIds: step.keepIds,
      })
    } else if (action === 'enter') {
      await pos.enter(step.id, step)
    } else if (action === 'exit') {
      await pos.exit(step.id, step)
    } else if (action === 'faceAll') {
      pos.faceAll(step.ids || [], step.face || 'right')
    } else if (action === 'unclump') {
      await pos.unclump(step.ids || [], { minGap: step.minGap })
    } else if (action === 'rest' || action === 'returnHome') {
      // soft=回本阵；hard/formation=按阵型重算再落位（节拍边界）
      await pos.rest({
        ids: step.ids,
        ms: step.ms,
        hard: step.hard,
        formation: step.formation,
        keepIds: step.keepIds,
        camera: step.camera,
        zoom: step.zoom,
      })
    } else if (action === 'resetFormation' || action === 'reset') {
      await pos.resetFormation(step.formation, {
        ms: step.ms,
        zoom: step.zoom,
        camera: step.camera,
        keepIds: step.keepIds,
      })
    }
    // —— 动作导演 ——
    else if (action === 'lunge') {
      await act.lunge(step.id, step.target, step)
    } else if (action === 'clash') {
      await act.clash(step.a || step.id, step.b || step.target, step)
    } else if (action === 'knockback') {
      await act.knockback(step.id, step)
    } else if (action === 'rush') {
      await act.rush(step.ids || [], step.target, step)
    } else if (action === 'freeze') {
      await act.freeze(step.id, step)
    } else if (action === 'buffScale') {
      await act.buffScale(step.id, step)
    } else if (action === 'dashThrough') {
      await act.dashThrough(step.id, step.target, step)
    } else if (action === 'stepBack') {
      await act.stepBack(step.id, step)
    } else if (action === 'knockdown') {
      await act.knockdown(step.ids || step.id, step)
    }
    // —— 总导演（节拍 / 镜头）——
    else if (action === 'beat') {
      await d.beat(step.name || step.beat, step)
    } else {
      console.warn('[Script] unknown direct action', action)
    }
  }
}

function rawSleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function resolveCamX(game, x) {
  if (x === 'stageCenter' || x === 'center') return game.map?.stageCenterX ?? 960
  return x
}
