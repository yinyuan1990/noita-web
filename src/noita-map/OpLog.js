// ── 操作日志:记输入/位置/卡住/报错,批量上传到 /updatesoft/noita-log/(服务端 scripts/noita-log-server.py)──
// 用法:const log = new OpLog({ url, meta }); log.ev('input', {...}); log.snapshot(...)
// 上传时机:卡住(立刻)、每 20s、切后台/关页(sendBeacon)、手动 flush()。会话 id 存 sessionStorage,刷新不变。
// 看日志:GET <url>list  → GET <url>get?f=YYYYMMDD/<session>.jsonl

export class OpLog {
  constructor({ url, meta = {}, interval = 20000, max = 600 } = {}) {
    this.url = url
    this.meta = meta
    this.max = max
    this.buf = []
    this.seq = 0
    this.session = sessionStorage.getItem('noita-log-session') || this._newId()
    sessionStorage.setItem('noita-log-session', this.session)
    this.t0 = performance.now()
    this.sent = 0; this.failed = 0
    this.timer = setInterval(() => this.flush('timer'), interval)
    window.addEventListener('pagehide', () => this.flush('pagehide', true))
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush('hidden', true) })
    window.addEventListener('error', (e) => this.ev('error', { msg: String(e.message).slice(0, 300), src: (e.filename || '').slice(-60), line: e.lineno }))
    window.addEventListener('unhandledrejection', (e) => this.ev('error', { msg: String(e.reason && (e.reason.stack || e.reason)).slice(0, 300) }))
    this.ev('open', { ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, cores: navigator.hardwareConcurrency, touch: matchMedia('(pointer: coarse)').matches, ...meta })
  }

  _newId() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${Math.random().toString(36).slice(2, 7)}`
  }

  /** 记一条事件(t = 会话内毫秒) */
  ev(e, data = {}) {
    this.buf.push({ i: this.seq++, t: Math.round(performance.now() - this.t0), e, ...data })
    if (this.buf.length > this.max) this.buf.splice(0, this.buf.length - this.max)
  }

  async flush(reason = 'manual', beacon = false) {
    if (!this.buf.length || !this.url) return false
    const events = this.buf.splice(0, this.buf.length)
    const body = JSON.stringify({ session: this.session, reason, ...this.meta, events })
    try {
      if (beacon && navigator.sendBeacon) {
        if (navigator.sendBeacon(this.url, new Blob([body], { type: 'application/json' }))) { this.sent += events.length; return true }
      }
      const r = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: beacon })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      this.sent += events.length
      return true
    } catch (err) {
      this.failed += events.length
      this.buf.unshift(...events.slice(-100)) // 失败留最近 100 条下次再试
      return false
    }
  }
}
