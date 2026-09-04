import * as PIXI from 'pixi.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT, CAST, CHAPTER1_CAST_IDS, CHAPTER2_CAST_IDS } from '../config.js'
import { MapSystem } from '../systems/MapSystem.js'
import { CharacterSystem } from '../systems/CharacterSystem.js'
import { DialogueSystem } from '../systems/DialogueSystem.js'
import { EffectSystem } from '../systems/EffectSystem.js'
import { CameraSystem } from '../systems/CameraSystem.js'
import { DirectorSystem } from '../systems/DirectorSystem.js'
import { SoundSystem, setSkillSfxTable } from '../audio/SoundSystem.js'
import { SKILL_SFX } from '../director/skills.js'
import { ScriptRunner } from './ScriptRunner.js'
import { CHAPTERS } from '../chapters.js'

/** Pixi 5 Application */
export class Game {
  constructor(host) {
    this.host = host
    this.app = null
    this.camera = null
    this.director = null
    this.map = null
    this.chars = null
    this.dialogue = null
    this.fx = null
    this.sound = null
    this.runner = null
    this.currentChapter = null
    this._fadeEl = null
  }

  async init() {
    this.app = new PIXI.Application({
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      backgroundColor: 0x0a0c12,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    this.host.appendChild(this.app.view)

    this.mapLayer = new PIXI.Container()
    this.charLayer = new PIXI.Container()
    this.fxLayer = new PIXI.Container()

    this.map = new MapSystem(this)
    this.chars = new CharacterSystem(this)
    this.dialogue = new DialogueSystem(this)
    this.fx = new EffectSystem(this)
    this.sound = new SoundSystem(this)
    setSkillSfxTable(SKILL_SFX)
    this.sound.preloadAll()
    this.camera = new CameraSystem(this)
    this.camera.attach([this.mapLayer, this.charLayer, this.fxLayer])
    this.director = new DirectorSystem(this)
    this.runner = new ScriptRunner(this)
    this._fadeEl = document.getElementById('fade')

    // 浏览器需用户手势解锁 AudioContext
    const unlock = () => {
      void this.sound.unlock()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)

    this.app.ticker.add(() => {
      if (this.runner?.paused) return
      const dt = this.app.ticker.deltaMS / 1000
      this.chars.update(dt)
      this.fx?.update?.(dt)
      this.camera.update()
      this.dialogue?.update?.()
    })

    this._fit()
    window.addEventListener('resize', () => this._fit())
  }

  _fit() {
    if (this.app && this.app.view) {
      this.app.view.style.width = '100%'
      this.app.view.style.height = '100%'
    }
  }

  togglePause() {
    return this.runner.togglePause()
  }

  async fade(to = 'black', ms = 500) {
    const el = this._fadeEl
    if (!el) return
    const wantBlack = to === 'black' || to === 1 || to === 'in'
    if (wantBlack) {
      el.classList.add('on')
      el.style.transitionDuration = `${ms}ms`
      el.style.opacity = '1'
      await sleep(ms)
    } else {
      el.style.transitionDuration = `${ms}ms`
      el.style.opacity = '0'
      await sleep(ms)
      el.classList.remove('on')
    }
  }

  /** 从剧本收集需要预加载的角色 id */
  collectCastIds(script) {
    const ids = new Set()
    for (const step of script) {
      if (step.id && CAST[step.id]) ids.add(step.id)
      if (step.who && CAST[step.who]) ids.add(step.who)
      if (Array.isArray(step.ids)) {
        for (const id of step.ids) if (CAST[id]) ids.add(id)
      }
      if (Array.isArray(step.actors)) {
        for (const a of step.actors) {
          if (a?.id && CAST[a.id]) ids.add(a.id)
        }
      }
      if (step.formation || (step.cmd === 'direct' && step.action === 'enterFormation')) {
        const name = step.formation
        if (name === 'party_six') {
          for (const id of CHAPTER1_CAST_IDS.filter((x) => x !== 'lelin')) ids.add(id)
        } else if (name === 'party_seven' || name === 'party_seven_narrow') {
          for (const id of CHAPTER1_CAST_IDS) ids.add(id)
        } else if (name === 'ambush_faceoff' || name === 'ambush_priest') {
          for (const id of CHAPTER1_CAST_IDS) ids.add(id)
          ids.add('jakaluo')
          if (name === 'ambush_priest') ids.add('motiya')
        }
      }
      if (step.id === 'motiya' || step.who === 'motiya') ids.add('motiya')
      if (step.id === 'jakaluo' || step.who === 'jakaluo') ids.add('jakaluo')
      if (step.id === 'hellsnake' || step.who === 'hellsnake') ids.add('hellsnake')
    }
    // 出现敌方时把第二章 casting 一并预载
    if (ids.has('jakaluo') || ids.has('motiya') || ids.has('hellsnake')) {
      for (const id of CHAPTER2_CAST_IDS) ids.add(id)
    }
    if (ids.size === 0) {
      for (const id of CHAPTER1_CAST_IDS) ids.add(id)
    }
    return [...ids]
  }

  async preload(script, onProgress) {
    const ids = this.collectCastIds(script)
    const mapStep = script.find((s) => s.cmd === 'setMap')
    const mapId = mapStep?.map || 'cave_tunnel'
    const total = ids.length + 1
    let done = 0
    const report = (label) => onProgress?.(done / total, label)

    report('舞台')
    await this.map.load(mapId)
    done += 1
    report('舞台')

    for (const id of ids) {
      const label = CAST[id]?.label || id
      report(label)
      await this.chars.preload(id)
      done += 1
      report(label)
    }
  }

  async resetScene() {
    this.runner.stop()
    this.dialogue.hideAll()
    this.camera?.stopFollow?.()
    this.camera?.unlock?.()
    await this.chars.hideAll({ exit: 'instant' })
    if (this._fadeEl) {
      this._fadeEl.style.opacity = '0'
      this._fadeEl.classList.remove('on')
    }
  }

  /**
   * 播放指定章节；continues=true 时第一章结束后自动进第二章
   * @returns {'done'|'stopped'|'continued'}
   */
  async playChapter(chapterId, { continueNext = false, onStatus, onReady } = {}) {
    const meta = CHAPTERS[chapterId]
    if (!meta) throw new Error(`unknown chapter ${chapterId}`)

    onStatus?.(`读取${meta.short}…`)
    const res = await fetch(meta.url)
    if (!res.ok) throw new Error(`${meta.url} → ${res.status}`)
    const script = await res.json()

    await this.resetScene()
    this.currentChapter = meta.id
    onStatus?.(`加载${meta.short}…`)
    await this.preload(script, (p, label) => {
      onStatus?.(`${meta.short} ${Math.round(p * 100)}%\n${label || ''}`)
    })

    document.getElementById('hud-chapter') &&
      (document.getElementById('hud-chapter').textContent = meta.title)

    // 预加载完成立刻揭幕，开始播剧本
    onReady?.()

    const finished = await this.runner.run(script, { label: meta.short })
    if (!finished) return 'stopped'

    if (continueNext && meta.next) {
      onStatus?.(`衔接${CHAPTERS[meta.next].short}…`)
      await this.fade('black', 600)
      const next = await this.playChapter(meta.next, { continueNext: false, onStatus, onReady })
      return next === 'done' ? 'continued' : next
    }
    return 'done'
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
