// 构建 Noita 地图模块查看器 → dist-noita/(见 vite.config.js 的 IS_NOITA 分支)
import { spawnSync } from 'node:child_process'
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], {
  stdio: 'inherit', shell: process.platform === 'win32',
  env: { ...process.env, BUILD_TARGET: 'noita' },
})
process.exit(r.status ?? 1)
