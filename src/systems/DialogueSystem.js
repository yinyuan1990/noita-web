import * as PIXI from 'pixi.js'

/**
 * 旁白 / 人物说话：同一套 HTML 面板样式与高度规则
 * - 旁白：左上角固定
 * - 说话：挂在人物头顶，每行最多 10 字换行，高度随内容自动撑开
 */
const MAX_CHARS = 10

export class DialogueSystem {
  constructor(game) {
    this.game = game
    this.narrateBox = document.getElementById('narrate')
    this.narrateLabel = document.getElementById('narrate-label')
    this.narrateText = document.getElementById('narrate-text')
    this.speechBox = document.getElementById('speech')
    this.speechLabel = document.getElementById('speech-label')
    this.speechText = document.getElementById('speech-text')
    this._token = 0
    this._speechActor = null
  }

  update() {
    if (this._speechActor && this.speechBox?.classList.contains('visible')) {
      this._placeSpeech(this._speechActor)
    }
  }

  hideNarrate() {
    this.narrateBox?.classList.remove('visible')
  }

  hideBubble() {
    this.speechBox?.classList.remove('visible')
    if (this.speechText) this.speechText.textContent = ''
    this._speechActor = null
  }

  hideAll() {
    this.hideNarrate()
    this.hideBubble()
  }

  async narrate(text, opts = {}) {
    this.hideBubble()
    const token = ++this._token
    if (!this.narrateBox || !this.narrateText) return
    if (this.narrateLabel) this.narrateLabel.textContent = '旁白'
    this.narrateBox.classList.remove('is-speaker')
    this.narrateBox.classList.add('visible')
    this.narrateText.textContent = ''
    await this._typeInto(
      (s) => {
        if (token !== this._token) return
        this.narrateText.textContent = s
      },
      text || '',
      token,
      opts,
    )
  }

  async say(actor, text, opts = {}) {
    this.hideNarrate()
    const token = ++this._token
    this.hideBubble()
    if (!actor?.view || !this.speechBox) return

    const name = (actor.cast && actor.cast.label) || actor.id || ''
    if (this.speechLabel) this.speechLabel.textContent = name
    this.speechBox.classList.add('is-speaker', 'visible')
    this.speechText.textContent = ''
    this._speechActor = actor
    this._placeSpeech(actor)

    await this._typeInto(
      (s) => {
        if (token !== this._token) return
        // 每行最多 10 字；高度由 CSS 随内容自动计算（与旁白相同）
        this.speechText.textContent = wrapByChars(s, MAX_CHARS)
        this._placeSpeech(actor)
      },
      text || '',
      token,
      { cps: 30, ...opts },
    )
    // 打完字读完即收，不拖到下一步
    if (token === this._token) this.hideBubble()
  }

  /** 将气泡锚在角色头顶上方（屏幕坐标） */
  _placeSpeech(actor) {
    const el = this.speechBox
    const host = this.game.host
    const app = this.game.app
    if (!el || !host || !app || !actor?.view) return

    let headTop = -220
    if (actor.spine) {
      try {
        const b = actor.spine.getLocalBounds()
        const sy = Math.abs(actor.spine.scale.y) || 1
        headTop = b.y * sy
      } catch (e) {
        void e
      }
    }

    const pt = actor.view.toGlobal(new PIXI.Point(0, headTop))
    const canvas = app.view
    const canvasRect = canvas.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const sx = canvasRect.width / Math.max(1, app.screen.width)
    const sy = canvasRect.height / Math.max(1, app.screen.height)
    const x = canvasRect.left - hostRect.left + pt.x * sx
    const y = canvasRect.top - hostRect.top + pt.y * sy

    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }

  async _typeInto(setter, text, token, { cps = 30, hold = null, sleep: sleepFn } = {}) {
    const wait = sleepFn || sleep
    const delay = Math.max(16, Math.floor(1000 / cps))
    for (let i = 0; i < text.length; i++) {
      if (token !== this._token) return
      setter(text.slice(0, i + 1))
      // 标点处顿一下，节奏像在「说」而不是匀速打字机
      await wait(delay * (PUNCT_PAUSE[text[i]] || 1))
    }
    if (token !== this._token) return
    // 收尾停留随句长伸缩：短句快收，长句留够读完的时间
    const holdMs = hold != null ? hold : Math.min(1400, 300 + text.length * 24)
    await wait(holdMs)
  }
}

/** 标点 → 打字延迟倍数 */
const PUNCT_PAUSE = {
  '，': 4,
  '、': 3,
  '；': 5,
  '：': 4,
  '。': 7,
  '！': 7,
  '？': 7,
  '…': 8,
  ',': 4,
  '.': 6,
  '!': 7,
  '?': 7,
}

function wrapByChars(str, n) {
  if (!str) return ''
  const out = []
  const paras = String(str).split('\n')
  for (const para of paras) {
    if (!para) {
      out.push('')
      continue
    }
    for (let i = 0; i < para.length; i += n) {
      out.push(para.slice(i, i + n))
    }
  }
  return out.join('\n')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
