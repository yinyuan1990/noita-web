/**
 * 抖音竖屏自动录制：第一章 + 第二章 各一支 9:16 视频
 *
 * 用法（先开 dev server）：
 *   cd web && npm run record:douyin
 *
 * 输出：
 *   ../videos/第一章-通道集合.mp4
 *   ../videos/第二章-被背叛.mp4
 */
import { chromium } from 'playwright'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const OUT_DIR = path.join(ROOT, 'videos')
const TMP_DIR = path.join(OUT_DIR, '_tmp')
const BASE = process.env.BASE || 'http://localhost:5177'
const VW = 1080
const VH = 1920
const TIMEOUT_MS = Number(process.env.REC_TIMEOUT_MS || 9 * 60 * 1000)

const CHROME_CANDIDATES = [
  process.env.PW_CHROME,
  'C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  'C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe',
].filter(Boolean)

const CHAPTERS = [
  {
    ch: 1,
    query: 'rec=1&v=1',
    name: '第一章-通道集合',
  },
  {
    ch: 2,
    query: 'rec=1&v=1&ch=2',
    name: '第二章-被背叛',
  },
]

function log(...a) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  console.log(`[${t}]`, ...a)
}

function findChrome() {
  return CHROME_CANDIDATES.find((p) => fs.existsSync(p))
}

function run(cmd, args, inherit = true) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: inherit ? 'inherit' : 'ignore', shell: true })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))))
  })
}

const FFMPEG_CANDIDATES = [
  'ffmpeg',
  path.join(process.env.TEMP || '', 'ffstatic', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  'C:\\Users\\admin\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe',
]

async function hasFfmpeg() {
  for (const cmd of FFMPEG_CANDIDATES) {
    try {
      await run(cmd, ['-hide_banner', '-version'], false)
      return cmd
    } catch {
      /* next */
    }
  }
  return null
}

async function waitServer() {
  const t0 = Date.now()
  while (Date.now() - t0 < 20000) {
    try {
      const r = await fetch(`${BASE}/chapter1.html`)
      if (r.ok) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`打不开 ${BASE} ，请先在 web 目录运行 npm run dev`)
}

async function toMp4(ffmpegCmd, webm, mp4) {
  await run(ffmpegCmd, [
    '-y',
    '-i',
    webm,
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'fast',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    mp4,
  ])
}

async function recordOne(browser, item, ffmpegCmd) {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP_DIR, size: { width: VW, height: VH } },
  })
  const page = await ctx.newPage()
  const url = `${BASE}/chapter1.html?${item.query}`
  log(`开始录 ${item.name}`)
  log(url)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(() => window.__chapter1?.hero, null, { timeout: 45000 })
  log(`${item.name} 已开演，等到结束…`)

  const t0 = Date.now()
  const tick = setInterval(async () => {
    const sec = Math.round((Date.now() - t0) / 1000)
    try {
      const st = await page.evaluate(() => !!window.__chapter1?.storyDone)
      log(`${item.name} ${sec}s${st ? ' · 已结束' : ''}`)
    } catch {
      log(`${item.name} ${sec}s`)
    }
  }, 10000)

  try {
    await page.waitForFunction(() => window.__chapter1?.storyDone === true, null, { timeout: TIMEOUT_MS })
  } finally {
    clearInterval(tick)
  }
  await page.waitForTimeout(900)
  const video = page.video()
  await page.close()
  await ctx.close()
  const webm = await video.path()
  const destWebm = path.join(OUT_DIR, `${item.name}.webm`)
  const destMp4 = path.join(OUT_DIR, `${item.name}.mp4`)
  fs.copyFileSync(webm, destWebm)
  log(`${item.name} webm → ${destWebm}`)
  if (ffmpegCmd) {
    await toMp4(ffmpegCmd, destWebm, destMp4)
    log(`${item.name} mp4 → ${destMp4}`)
  }
  return destMp4
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(TMP_DIR, { recursive: true })

await waitServer()
const ffmpegCmd = await hasFfmpeg().catch(() => null)
if (!ffmpegCmd) log('未找到 ffmpeg，将只保留 webm。抖音更认 mp4，装好 ffmpeg 后再转。')
else log('ffmpeg:', ffmpegCmd)

const launchOpts = {
  args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle'],
}
const chrome = findChrome()
if (chrome) launchOpts.executablePath = chrome

const browser = await chromium.launch(launchOpts)
try {
  for (const item of CHAPTERS) {
    await recordOne(browser, item, ffmpegCmd)
  }
} finally {
  await browser.close()
}

log('完成。发给抖音用竖屏 9:16 文件：')
for (const item of CHAPTERS) {
  const mp4 = path.join(OUT_DIR, `${item.name}.mp4`)
  const webm = path.join(OUT_DIR, `${item.name}.webm`)
  log(' -', fs.existsSync(mp4) ? mp4 : webm)
}
