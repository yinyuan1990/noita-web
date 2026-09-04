// 读 Noita data.wak: list | extract
//   node scripts/unpack-wak.mjs <data.wak> list [substr]
//   node scripts/unpack-wak.mjs <data.wak> extract <outDir> [substr]
import fs from 'node:fs'
import path from 'node:path'

const wakPath = process.argv[2]
const mode = process.argv[3] || 'list'
const a4 = process.argv[4] || ''
const a5 = process.argv[5] || ''
const outDir = mode === 'extract' ? a4 : ''
const needle = (mode === 'extract' ? a5 : a4).toLowerCase()

if (!wakPath) {
  console.error('usage: unpack-wak.mjs <data.wak> list [substr]\n       unpack-wak.mjs <data.wak> extract <outDir> [substr]')
  process.exit(1)
}

const fd = fs.openSync(wakPath, 'r')
const header = Buffer.alloc(16)
fs.readSync(fd, header, 0, 16, 0)
const version = header.readUInt32LE(0)
const fileCount = header.readUInt32LE(4)
const firstData = header.readUInt32LE(8)
console.log(`wak version=${version} files=${fileCount} data@${firstData}`)

const index = Buffer.alloc(firstData - 16)
fs.readSync(fd, index, 0, index.length, 16)
const entries = []
let p = 0
for (let i = 0; i < fileCount; i++) {
  const offset = index.readUInt32LE(p); p += 4
  const size = index.readUInt32LE(p); p += 4
  const nameLen = index.readUInt32LE(p); p += 4
  const name = index.subarray(p, p + nameLen).toString('utf8'); p += nameLen
  entries.push({ offset, size, name })
}

if (mode === 'list') {
  const shown = needle ? entries.filter((e) => e.name.toLowerCase().includes(needle)) : entries
  for (const e of shown) console.log(`${String(e.size).padStart(8)}  ${e.name}`)
  console.log(`-- ${shown.length}/${entries.length} --`)
} else if (mode === 'extract') {
  if (!outDir) { console.error('extract needs outDir'); process.exit(1) }
  let n = 0
  for (const e of entries) {
    const low = e.name.toLowerCase()
    if (needle && !low.includes(needle)) continue
    const dest = path.join(outDir, e.name.replace(/^data\//, ''))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const buf = Buffer.alloc(e.size)
    fs.readSync(fd, buf, 0, e.size, e.offset)
    fs.writeFileSync(dest, buf)
    n++
  }
  console.log(`extracted ${n} files -> ${outDir}`)
} else {
  console.error('mode must be list|extract')
  process.exit(1)
}
fs.closeSync(fd)
