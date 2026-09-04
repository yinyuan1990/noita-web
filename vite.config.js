import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

/** Spine 3.5 skins{} → 3.8 skins[]，dev 中间件即时转，原文件不动 */
function convertSpineJsonBuf(buf) {
  try {
    const data = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''))
    const sk = data.skins
    if (sk && !Array.isArray(sk) && typeof sk === 'object') {
      data.skins = Object.keys(sk).map((name) => ({ name, attachments: sk[name] }))
      if (data.skeleton) data.skeleton.spine = '3.8.99'
      return Buffer.from(JSON.stringify(data), 'utf8')
    }
  } catch (e) {
    void e
  }
  return buf
}

function serveRes() {
  const mounts = [
    ['/res/juese', path.join(root, 'juese')],
    ['/res/jineng', path.join(root, 'jineng')],
    ['/res/spine', path.join(root, 'spine')],
    ['/res/m387', path.join(root, 'M387-1205')],
    ['/res/noita-ref', path.join(__dirname, 'noita-ref')], // 存档真值 / 解包件(仅 dev 对照用,不进构建)
    ['/tele', path.join(root, 'silu/noita-telescope')], // 参考实现 noita-telescope 原样托管(对照 wang 层用)
  ]
  return {
    name: 'serve-res',
    configureServer(server) {
      for (const [base, dir] of mounts) {
        server.middlewares.use(base, (req, res, next) => {
          const rel = decodeURIComponent((req.url || '/').split('?')[0])
          let filePath = path.normalize(path.join(dir, rel))
          if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) return next()
          if (fs.statSync(filePath).isDirectory()) {
            const idx = path.join(filePath, 'index.html')
            if (!fs.existsSync(idx)) return next()
            filePath = idx
          }
          const ext = path.extname(filePath).toLowerCase()
          const types = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.json': 'application/json',
            '.atlas': 'text/plain; charset=utf-8',
            '.skel': 'application/octet-stream',
            '.tmx': 'application/xml',
            '.xml': 'application/xml',
            '.bin': 'application/octet-stream',
            '.lua': 'text/plain; charset=utf-8',
            '.csv': 'text/plain; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.mjs': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.html': 'text/html; charset=utf-8',
            '.zip': 'application/zip',
            '.ico': 'image/x-icon',
          }
          res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
          // jineng JSON：3.5 → 3.8 skins 转换后再吐
          if (ext === '.json' && base === '/res/jineng') {
            const raw = fs.readFileSync(filePath)
            res.end(convertSpineJsonBuf(raw))
            return
          }
          fs.createReadStream(filePath).pipe(res)
        })
      }
    },
  }
}

/** 构建产物里把 air-combat.html 复制一份为 index.html，让 .../fj/ 直接进游戏 */
function emitIndex() {
  return {
    name: 'emit-index',
    closeBundle() {
      const dist = path.join(__dirname, 'dist')
      const src = path.join(dist, 'air-combat.html')
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dist, 'index.html'))
    },
  }
}

// 部署子路径：https://update.cocoaihj.com/updatesoft/fj/  →  base '/updatesoft/fj/'
// 换部署位置时改这里（务必以 / 开头和结尾）。开发(dev)恒为 '/'。
const DEPLOY_BASE = '/updatesoft/fj/'

// 第二个构建目标：Noita 地图模块查看器（BUILD_TARGET=noita npm run build:noita）
//   → dist-noita/，base /updatesoft/noita/，只带 public/res/noita（11MB），不带空战的 40MB 资源
const NOITA_BASE = '/updatesoft/noita/'
const IS_NOITA = process.env.BUILD_TARGET === 'noita'

/** noita 构建：publicDir 关掉，只拷 res/noita */
function copyNoitaRes() {
  return {
    name: 'copy-noita-res',
    closeBundle() {
      const src = path.join(__dirname, 'public/res/noita')
      const dst = path.join(__dirname, 'dist-noita/res/noita')
      fs.rmSync(dst, { recursive: true, force: true })
      fs.cpSync(src, dst, { recursive: true })
      const html = path.join(__dirname, 'dist-noita/noita-map.html')
      if (fs.existsSync(html)) fs.copyFileSync(html, path.join(__dirname, 'dist-noita/index.html'))
    },
  }
}

export default defineConfig(({ command }) => (IS_NOITA
  ? {
    base: command === 'build' ? NOITA_BASE : '/',
    plugins: [copyNoitaRes()],
    publicDir: false,
    server: { port: 5177, fs: { allow: [root] } },
    build: {
      outDir: 'dist-noita',
      target: 'es2022', // 查看器用了顶层 await;iOS 15+/Chrome 89+ 均支持
      rollupOptions: { input: { 'noita-map': path.resolve(__dirname, 'noita-map.html'), 'noita-play': path.resolve(__dirname, 'noita-play.html') } },
    },
    worker: { format: 'es' },
  }
  : {
    base: command === 'build' ? DEPLOY_BASE : '/',
    plugins: [serveRes(), emitIndex()],
    server: { port: 5177, fs: { allow: [root] } },
    optimizeDeps: { exclude: ['pixi-spine'] },
    build: {
      // 只构建空战游戏（其余 demo 依赖 dev 中间件资源，不适合独立部署）
      rollupOptions: {
        input: { 'air-combat': path.resolve(__dirname, 'air-combat.html') },
      },
    },
  }))
