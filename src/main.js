import { Game } from './core/Game.js'
import { DESIGN_WIDTH, DESIGN_HEIGHT, CAST } from './config.js'
import { seffectAt, SEFFECT_INDEX } from './data/seffectIndex.js'
import { CHAPTERS } from './chapters.js'

const boot = document.getElementById('boot')
const menu = document.getElementById('menu')
const controls = document.getElementById('controls')
const host = document.getElementById('stage-host')
const params = new URLSearchParams(location.search)
const PROBE = params.get('probe')

let game = null
let busy = false

function fitCanvas(app) {
  if (!app || !app.view || !host) return
  const view = app.view
  view.style.width = '100%'
  view.style.height = '100%'
  view.style.display = 'block'
  void (host.getBoundingClientRect().width / DESIGN_WIDTH)
  void (host.getBoundingClientRect().height / DESIGN_HEIGHT)
  app.renderer.plugins.interaction.resolution = app.renderer.resolution
}

function setBoot(msg, show = true) {
  if (!boot) return
  boot.textContent = msg
  boot.classList.toggle('show', show)
  boot.classList.remove('error')
}

function showMenu(show) {
  menu?.classList.toggle('hide', !show)
  controls?.classList.toggle('show', !show)
  if (show) {
    document.getElementById('hud-chapter') && (document.getElementById('hud-chapter').textContent = '选章')
    document.getElementById('hud-script') && (document.getElementById('hud-script').textContent = 'IDLE')
  }
}

async function startChapter(id, continueNext) {
  if (!game || busy) return
  busy = true
  showMenu(false)
  setBoot(`${CHAPTERS[id]?.short || ''}…`, true)
  try {
    const result = await game.playChapter(id, {
      continueNext,
      onStatus: (msg) => setBoot(msg, true),
      onReady: () => setBoot('', false),
    })
    setBoot('', false)
    if (result === 'stopped') {
      showMenu(true)
    } else {
      // 播完回选章
      await game.fade('black', 400)
      await game.resetScene()
      await game.fade('clear', 400)
      showMenu(true)
    }
  } catch (err) {
    console.error(err)
    boot.classList.add('show', 'error')
    boot.textContent = `启动失败\n${err?.stack || err}`
    showMenu(true)
  } finally {
    busy = false
    game.runner?.setPaused(false)
  }
}

function wireUi() {
  menu?.querySelectorAll('button.choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.start)
      const cont = btn.dataset.continue === '1'
      startChapter(id, cont)
    })
  })

  document.getElementById('btn-pause')?.addEventListener('click', () => {
    game?.togglePause()
  })
  document.getElementById('btn-menu')?.addEventListener('click', () => {
    if (!game) return
    game.runner.stop()
    game.runner.setPaused(false)
    game.resetScene()
    setBoot('', false)
    showMenu(true)
    busy = false
  })

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === 'p' || e.key === 'P') {
      if (menu && !menu.classList.contains('hide')) return
      e.preventDefault()
      game?.togglePause()
    }
    if (e.key === 'Escape') {
      if (menu && !menu.classList.contains('hide')) return
      game?.runner.stop()
      game?.runner.setPaused(false)
      game?.resetScene()
      setBoot('', false)
      showMenu(true)
      busy = false
    }
  })
}

/** ?probe=fx / cast 保留调试入口 */
async function runProbe() {
  await game.map.load('cave_tunnel')
  game.camera.cut({ x: 960, y: 540, zoom: 1 })
  showMenu(false)
  setBoot('', false)
  controls?.classList.add('show')

  if (PROBE === 'cast' || PROBE === 'fx') {
    const ids = ['jakaluo', 'motiya', 'hellsnake']
    await game.chars.preloadMany(ids)
    await game.chars.show('jakaluo', { slot: 'left', face: 'right', enter: 'fade' })
    await game.chars.show('motiya', { slot: 'center', face: 'left', enter: 'fade' })
    await game.chars.show('hellsnake', { slot: 'right', face: 'left', enter: 'fade' })
    console.info(
      '[probe cast]',
      ids.map((id) => `${id}=#${CAST[id].jueseIndex}:${CAST[id].folder}`).join(' · ')
    )
  }

  if (PROBE === 'fx') {
    const hud = document.getElementById('hud-script')
    for (let i = 0; i < 5; i++) {
      const folder = seffectAt((Date.now() + i * 17) % SEFFECT_INDEX.length)
      if (hud) hud.textContent = `FX PROBE ${i + 1}/5 · ${folder}`
      const ok = await game.fx.play(folder, {
        to: i % 2 ? 'motiya' : 'jakaluo',
        ms: 1400,
        scale: 0.5,
      })
      console.info('[probe fx]', folder, ok ? 'OK' : 'FAIL')
    }
    if (hud) hud.textContent = `FX PROBE DONE · pool=${SEFFECT_INDEX.length}`
  }
}

async function main() {
  try {
    setBoot('初始化…', true)
    game = new Game(host)
    await game.init()
    fitCanvas(game.app)
    window.addEventListener('resize', () => fitCanvas(game.app))
    wireUi()

    if (PROBE === 'fx' || PROBE === 'cast') {
      await runProbe()
      return
    }

    // URL 快捷：?ch=1 / ?ch=2
    const ch = Number(params.get('ch'))
    setBoot('', false)
    if (ch === 1 || ch === 2) {
      showMenu(false)
      await startChapter(ch, ch === 1 && params.get('continue') !== '0')
    } else {
      showMenu(true)
    }
  } catch (err) {
    console.error(err)
    boot.classList.add('show', 'error')
    boot.textContent = `启动失败\n${err?.stack || err}`
  }
}

main()
