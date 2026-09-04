// 用真实 pixi-spine 运行时验证候选角色的完整动画列表（借 cast-load-test.html 的环境）
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), '..', 'juese')

// 与 scan-spine-anims.mjs 相同的粗筛逻辑，拿候选文件夹列表
const VOCAB_IDLE = ['idle', 'daiji', 'stand', 'holdon', 'breath']
const VOCAB_MOVE = ['run', 'walk', 'move', 'zou', 'go']
const VOCAB_SKILL = ['skill', 'attack', 'att', 'atk', 'pugong', 'jineng', 'dazhao']

function extractStrings(buf) {
  const out = new Set()
  let cur = ''
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || (c >= 65 && c <= 90)) {
      cur += String.fromCharCode(c).toLowerCase()
    } else {
      if (cur.length >= 2 && cur.length <= 24) out.add(cur)
      cur = ''
    }
  }
  return out
}
const matches = (strs, keys) =>
  [...strs].filter((s) => keys.some((k) => s === k || new RegExp(`^${k}[_]?\\d{0,2}$`).test(s)))

const candidates = []
for (const dir of fs.readdirSync(ROOT)) {
  const full = path.join(ROOT, dir)
  if (!fs.statSync(full).isDirectory()) continue
  const skelFile = fs.readdirSync(full).find((f) => f.endsWith('.skel'))
  if (!skelFile) continue
  const strs = extractStrings(fs.readFileSync(path.join(full, skelFile)))
  if (
    matches(strs, VOCAB_IDLE).length &&
    matches(strs, VOCAB_MOVE).length &&
    matches(strs, VOCAB_SKILL).length >= 2
  ) {
    candidates.push(dir)
  }
}
console.log(`候选 ${candidates.length} 个，开始运行时验证...`)

const b = await chromium.launch({ channel: 'msedge', headless: true })
const p = await b.newPage()
await p.goto('http://localhost:5177/cast-load-test.html', { waitUntil: 'networkidle' })
await p.waitForSelector('html[data-result]', { timeout: 30000 })

// 扫描进度写到 window，Node 侧轮询取结果（长任务 evaluate 的返回 promise 会被 GC）
await p.evaluate((folders) => {
  window.__scanResult = {}
  window.__scanDone = false
  ;(async () => {
    for (const f of folders) {
      try {
        const data = await new Promise((resolve) => {
          // 个别资源缺图会让 Loader 永久挂起，8 秒直接放弃
          const timer = setTimeout(() => resolve('timeout'), 8000)
          const loader = new window.PIXI.Loader()
          loader.add(f, `/res/juese/${f}/${f}.skel`)
          loader.onError.add(() => {
            clearTimeout(timer)
            resolve(null)
          })
          loader.load((_, res) => {
            clearTimeout(timer)
            resolve(res[f]?.spineData || null)
          })
        })
        if (data === 'timeout') {
          window.__scanResult[f] = ['<加载超时>']
          continue
        }
        window.__scanResult[f] = data
          ? data.animations.map((a) => `${a.name}(${a.duration.toFixed(1)}s)`)
          : ['<加载失败>']
      } catch (e) {
        window.__scanResult[f] = [`<异常 ${e.message}>`]
      }
    }
    window.__scanDone = true
  })()
}, candidates)

let result = {}
let lastN = -1
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  const st = await p.evaluate(() => ({
    done: window.__scanDone,
    n: Object.keys(window.__scanResult).length,
  }))
  if (st.n !== lastN) {
    lastN = st.n
    console.log(`已扫 ${st.n}/${candidates.length}`)
  }
  if (st.done) break
}
result = await p.evaluate(() => window.__scanResult)
console.log('')

await b.close()

for (const [f, anims] of Object.entries(result)) {
  console.log(`\n${f}  (${anims.length})\n  ${anims.join(', ')}`)
}
