import * as PIXI from 'pixi.js'
import { CAST } from '../config.js'
import { loadPixiSpine, getSpineClass, listAnims } from '../utils/loadPixiSpine.js'
import { RES } from '../config.js'

const logEl = document.getElementById('log')
const lines = []
const log = (s) => {
  lines.push(String(s))
  if (logEl) logEl.textContent = lines.join('\n')
  document.title = String(s)
}

async function loadSpine(folder) {
  const base = `${RES.juese}/${folder}/${folder}`
  const key = `c_${folder}`
  const tryUrl = (url) =>
    new Promise((resolve) => {
      const loader = new PIXI.Loader()
      loader.add(key + url, url).load((_, res) => resolve(res[key + url]?.spineData || null))
      loader.onError.add(() => resolve(null))
    })
  return (await tryUrl(`${base}.skel`)) || (await tryUrl(`${base}.json`))
}

async function main() {
  window.PIXI = PIXI
  await loadPixiSpine()
  const Spine = getSpineClass()
  if (!Spine) throw new Error('Spine missing')

  const ids = ['jakaluo', 'motiya', 'hellsnake']
  let ok = 0
  let fail = 0
  for (const id of ids) {
    const c = CAST[id]
    const data = await loadSpine(c.folder)
    if (!data) {
      fail++
      log(`FAIL ${id} #${c.jueseIndex} ${c.folder}`)
      continue
    }
    const spine = new Spine(data)
    ok++
    log(`OK ${id} #${c.jueseIndex} ${c.folder} anims=${listAnims(spine).slice(0, 6).join(',')}`)
    spine.destroy({ children: true })
  }
  const summary = `RESULT ok=${ok} fail=${fail}`
  log(summary)
  document.documentElement.setAttribute('data-result', `ok=${ok};fail=${fail}`)
}

main().catch((e) => {
  log(`FATAL ${e?.stack || e}`)
  document.documentElement.setAttribute('data-result', 'fatal')
})
