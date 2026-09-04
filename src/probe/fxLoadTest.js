import * as PIXI from 'pixi.js'
import { loadPixiSpine, getSpineClass, listAnims } from '../utils/loadPixiSpine.js'

const logEl = document.getElementById('log')
const lines = []
const log = (s) => {
  lines.push(String(s))
  if (logEl) logEl.textContent = lines.join('\n')
  document.title = String(s)
}

async function main() {
  window.PIXI = PIXI
  await loadPixiSpine()
  const Spine = getSpineClass()
  if (!Spine) throw new Error('Spine class missing')

  const samples = [
    'seffect_60001',
    'seffect_100110111',
    'seffect_445061',
    'seffect_52513100111',
    'seffect_70001',
  ]
  let ok = 0
  let fail = 0
  for (const folder of samples) {
    const url = `/res/jineng/seffect/${folder}/${folder}.json`
    const data = await new Promise((resolve) => {
      const key = `t_${folder}`
      const loader = new PIXI.Loader()
      loader.add(key, url).load((_, res) => resolve(res[key]?.spineData || null))
      loader.onError.add((err) => {
        log(`ERR ${folder} ${err?.message || err}`)
        resolve(null)
      })
    })
    if (!data) {
      fail++
      log(`FAIL ${folder}`)
      continue
    }
    const spine = new Spine(data)
    ok++
    log(`OK ${folder} anims=${listAnims(spine).join(',')}`)
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
