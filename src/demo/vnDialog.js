/**
 * 视觉小说式对话 UI（DOM overlay）
 * - 底部对话框：名牌（角色配色）+ 正文自然换行 + 打字机（匀速逐字，无标点停顿）+ ▼ 继续指示
 * - 旁白：同一个框，名牌换成灰色「旁白」，正文偏灰
 * - 推进：点击 / 空格 / 回车；打字中点击 = 立刻出全文，再点 = 下一句
 * - 章节题卡：title() 大字居中淡入淡出
 */

const CSS = `
.vn-root { position:absolute; inset:0; z-index:20; pointer-events:none; font-family:"Noto Serif SC","Songti SC",Georgia,serif; }
.vn-shade { position:absolute; left:0; right:0; bottom:0; height:38%; pointer-events:none; opacity:0; transition:opacity .35s;
  background:linear-gradient(to top, rgba(4,7,12,.78), rgba(4,7,12,.35) 55%, transparent); }
.vn-root.on .vn-shade { opacity:1; }
.vn-box { position:absolute; left:50%; bottom:4.5%; transform:translate(-50%, 14px); width:min(880px, 92%);
  min-height:112px; padding:20px 26px 26px; box-sizing:border-box; border-radius:14px;
  background:linear-gradient(160deg, rgba(16,22,32,.92), rgba(9,13,20,.94));
  border:1px solid rgba(140,165,195,.28); box-shadow:0 10px 40px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06);
  backdrop-filter:blur(6px); opacity:0; transition:opacity .28s, transform .28s; pointer-events:none; }
.vn-root.on .vn-box { opacity:1; transform:translate(-50%, 0); pointer-events:auto; }
.vn-name { position:absolute; top:-16px; left:20px; padding:4px 16px 5px; border-radius:8px; font-size:15px; font-weight:700;
  letter-spacing:2px; color:#fff; background:linear-gradient(135deg, #3d6e4f, #274633);
  border:1px solid rgba(255,255,255,.22); box-shadow:0 4px 14px rgba(0,0,0,.45); }
.vn-name.narrator { background:linear-gradient(135deg, #3a4250, #262c38); color:#aeb9c8; letter-spacing:6px; padding-right:10px; }
.vn-text { font-size:17px; line-height:1.95; color:#eef3f8; letter-spacing:.4px; text-shadow:0 1px 2px rgba(0,0,0,.6);
  min-height:66px; }
.vn-text.narr { color:#c8d2de; }
.vn-next { position:absolute; right:18px; bottom:10px; font-size:13px; color:#9ed48a; opacity:0;
  animation:vnBounce 1.1s ease-in-out infinite; }
.vn-next.show { opacity:.9; }
@keyframes vnBounce { 0%,100% { transform:translateY(0); } 50% { transform:translateY(4px); } }
.vn-title { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:14px; background:rgba(3,5,9,.66); opacity:0; transition:opacity .6s; pointer-events:none; }
.vn-title.show { opacity:1; }
.vn-title h1 { font-size:44px; font-weight:700; color:#f2f6fa; letter-spacing:14px; text-indent:14px; margin:0;
  text-shadow:0 2px 18px rgba(120,200,150,.35), 0 1px 2px #000; }
.vn-title p { font-size:15px; color:#93a6b8; letter-spacing:5px; margin:0; }
.vn-fade { position:absolute; inset:0; background:#03050a; opacity:0; transition:opacity .7s; pointer-events:none; }
html.portrait .vn-box { width:92%; bottom:12%; min-height:128px; padding:18px 20px 24px; }
html.portrait .vn-text { font-size:16px; line-height:1.85; }
html.portrait .vn-title h1 { font-size:36px; letter-spacing:10px; text-indent:10px; padding:0 20px; text-align:center; }
`

export class VNDialog {
  constructor(host) {
    this.host = host
    this.instant = false // 测试用：瞬间出全文 + 自动推进
    this.auto = true // 自动播放：打完字按文长停留后自动下一句（点击仍可提前）
    if (!document.getElementById('vn-style')) {
      const st = document.createElement('style')
      st.id = 'vn-style'
      st.textContent = CSS
      document.head.appendChild(st)
    }
    const root = document.createElement('div')
    root.className = 'vn-root'
    root.innerHTML = `
      <div class="vn-shade"></div>
      <div class="vn-fade"></div>
      <div class="vn-box">
        <div class="vn-name"></div>
        <div class="vn-text"></div>
        <div class="vn-next">▼</div>
      </div>
      <div class="vn-title"><h1></h1><p></p></div>`
    host.appendChild(root)
    this.root = root
    this.box = root.querySelector('.vn-box')
    this.nameEl = root.querySelector('.vn-name')
    this.textEl = root.querySelector('.vn-text')
    this.nextEl = root.querySelector('.vn-next')
    this.titleEl = root.querySelector('.vn-title')
    this.fadeEl = root.querySelector('.vn-fade')

    this._advance = null // 等待推进的 resolve
    this._typing = false
    this._skipType = false
    const onAdvance = (e) => {
      if (e.type === 'keydown' && e.code !== 'Space' && e.code !== 'Enter') return
      if (e.type === 'keydown') e.preventDefault()
      if (this._typing) this._skipType = true
      else if (this._advance) {
        const r = this._advance
        this._advance = null
        r()
      }
    }
    host.addEventListener('pointerdown', onAdvance)
    window.addEventListener('keydown', onAdvance)
  }

  /** 章节题卡：大字居中，停留后淡出 */
  async title(main, sub = '', holdMs = 2200) {
    this.titleEl.querySelector('h1').textContent = main
    this.titleEl.querySelector('p').textContent = sub
    this.titleEl.classList.add('show')
    await sleep(this.instant ? 200 : holdMs)
    this.titleEl.classList.remove('show')
    await sleep(this.instant ? 100 : 650)
  }

  /** 黑场淡入/淡出：to=1 变黑，to=0 变亮 */
  async fade(to, ms = 700) {
    this.fadeEl.style.transitionDuration = `${ms}ms`
    this.fadeEl.style.opacity = String(to)
    await sleep(this.instant ? 80 : ms + 60)
  }

  async narrate(text) {
    return this._line('旁白', text, { narrator: true })
  }

  async say(name, text, color = null) {
    return this._line(name, text, { color })
  }

  hide() {
    this.root.classList.remove('on')
    this.nextEl.classList.remove('show')
  }

  async _line(name, text, { narrator = false, color = null } = {}) {
    this.root.classList.add('on')
    this.nextEl.classList.remove('show')
    this.nameEl.textContent = name
    this.nameEl.classList.toggle('narrator', narrator)
    this.textEl.classList.toggle('narr', narrator)
    // 内联渐变必须每次重置，否则旁白名牌会沿用上一个说话人的颜色
    this.nameEl.style.background = !narrator && color
      ? `linear-gradient(135deg, ${color[0]}, ${color[1]})`
      : ''

    // 打字机：红白机式——每个字一顿，匀速逐字
    this._typing = true
    this._skipType = false
    const delay = 75
    if (this.instant) {
      this.textEl.textContent = text
    } else {
      this.textEl.textContent = ''
      for (let i = 0; i < text.length; i++) {
        if (this._skipType) {
          this.textEl.textContent = text
          break
        }
        this.textEl.textContent = text.slice(0, i + 1)
        await sleep(delay)
      }
    }
    this._typing = false
    this.nextEl.classList.add('show')

    // 推进：自动播放按文长停留（点击可提前），否则等点击
    if (this.instant) {
      await sleep(120)
    } else {
      await new Promise((r) => {
        this._advance = r
        if (this.auto) {
          // 红白机式：打完整句停 1 秒就走下一句
          setTimeout(() => {
            if (this._advance === r) {
              this._advance = null
              r()
            }
          }, 1000)
        }
      })
    }
    this.nextEl.classList.remove('show')
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
