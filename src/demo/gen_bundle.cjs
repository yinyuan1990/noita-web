// 导出「风暴雷神(z_leishen, DragonBones)」+「挂载L_15(CocoStudio)」的解析数据 -> skeleton_models.json
// 供 skeleton_player.js 使用。用法: node gen_bundle.cjs
const fs = require('fs'); const path = require('path')
const BASE = 'E:/soft/xiaoshuodongtai/ziyuan/main/assets'
const HERO = path.join(BASE, 'battlemodel/hero'); const HERODB = path.join(BASE, 'battlemodel/herodb')
const OUT = path.join(__dirname, 'skeleton_models.json')

const TEA_KEY = (() => { const b = Buffer.from('46E330EAFAF5C3E09D4A95835704AD7C', 'hex'); return [b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8), b.readUInt32LE(12)] })()
const MOD = 0x100000000
function teaBody(body, k) { const out = Buffer.alloc(body.length), D = 0x9e3779b9; for (let i = 0; i + 8 <= body.length; i += 8) { let v0 = body.readUInt32LE(i), v1 = body.readUInt32LE(i + 4), s = (D * 16) % MOD; for (let r = 0; r < 16; r++) { const a1 = ((((v0 << 4) >>> 0) + k[2]) % MOD) ^ ((v0 + s) % MOD) ^ (((v0 >>> 5) + k[3]) % MOD); v1 = ((v1 - (a1 >>> 0)) % MOD + MOD) % MOD; const a0 = ((((v1 << 4) >>> 0) + k[0]) % MOD) ^ ((v1 + s) % MOD) ^ (((v1 >>> 5) + k[1]) % MOD); v0 = ((v0 - (a0 >>> 0)) % MOD + MOD) % MOD; s = ((s - D) % MOD + MOD) % MOD } out.writeUInt32LE(v0 >>> 0, i); out.writeUInt32LE(v1 >>> 0, i + 4) } return out }
function pngDataUrl(buf) { const d = (buf.length > 5 && buf.toString('latin1', 0, 4) === 'GaMe') ? teaBody(buf.slice(5), TEA_KEY) : buf; if (d.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') return null; return 'data:image/png;base64,' + d.toString('base64') }
function decrypt(buf) { return (buf.length > 5 && buf.toString('latin1', 0, 4) === 'GaMe') ? teaBody(buf.slice(5), TEA_KEY) : buf }

function parsePlist(xml) { const frames = {}; const re = /<key>([^<]*\.png)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g; let m; while ((m = re.exec(xml))) { const name = m[1], body = m[2]; const g = k => { const mm = new RegExp('<key>' + k + '</key>\\s*<(?:integer|real)>(-?\\d+(?:\\.\\d+)?)</(?:integer|real)>').exec(body); return mm ? parseFloat(mm[1]) : 0 }; frames[name] = { x: g('x'), y: g('y'), w: g('width'), h: g('height') } } return frames }
function buildCS(modelName) {
  const ej = JSON.parse(fs.readFileSync(path.join(HERO, modelName + '.ExportJson'), 'utf8').replace(/^\uFEFF/, '')); const arm = ej.armature_data[0]
  const pngName = (arm.config_png_path && arm.config_png_path[0]) || (modelName + '0.png'); const plistName = (arm.config_file_path && arm.config_file_path[0]) || (modelName + '0.plist')
  const atlas = pngDataUrl(fs.readFileSync(path.join(HERO, pngName))); const frames = parsePlist(fs.readFileSync(path.join(HERO, plistName), 'utf8'))
  const bones = {}
  for (const bd of arm.bone_data) bones[bd.name] = { name: bd.name, parent: bd.parent || '', z: bd.z || 0, x: +bd.x || 0, y: +bd.y || 0, cX: bd.cX == null ? 1 : +bd.cX, cY: bd.cY == null ? 1 : +bd.cY, kX: +bd.kX || 0, kY: +bd.kY || 0, displays: (bd.display_data || []).map(d => ({ name: d.name, skin: (d.skin_data && d.skin_data[0]) || {} })) }
  const drawOrder = Object.values(bones).filter(b => b.displays.length).sort((a, b) => a.z - b.z).map(b => b.name)
  const anims = {}; const ad = ej.animation_data && ej.animation_data[0]
  if (ad) for (const mov of ad.mov_data) { const tracks = {}; for (const mb of mov.mov_bone_data) tracks[mb.name] = mb.frame_data.map(f => ({ fi: f.fi || 0, x: +f.x || 0, y: +f.y || 0, cX: f.cX == null ? 1 : +f.cX, cY: f.cY == null ? 1 : +f.cY, kX: +f.kX || 0, kY: +f.kY || 0, a: f.color && f.color.a != null ? f.color.a : 255, di: f.dI == null ? 0 : f.dI, bd: f.bd_dst == null ? 771 : f.bd_dst })); anims[mov.name] = { dr: mov.dr || 1, lp: !!mov.lp, tracks } }
  return { type: 'cs', atlas, frames, bones, drawOrder, anims }
}
function buildDB(dbName) {
  const atlas = pngDataUrl(fs.readFileSync(path.join(HERODB, dbName + '_tex.png')))
  const tex = JSON.parse(fs.readFileSync(path.join(HERODB, dbName + '_tex.json'), 'utf8').replace(/^\uFEFF/, '')); const sub = {}
  for (const s of tex.SubTexture) sub[s.name] = { x: s.x, y: s.y, w: s.width, h: s.height, fx: s.frameX || 0, fy: s.frameY || 0, fw: s.frameWidth || s.width, fh: s.frameHeight || s.height }
  const ske = JSON.parse(fs.readFileSync(path.join(HERODB, dbName + '_ske.json'), 'utf8').replace(/^\uFEFF/, '')); const arm = ske.armature[0]
  const bones = arm.bone.map(b => ({ name: b.name, parent: b.parent || '', t: b.transform || {} }))
  const slots = arm.slot.map(s => ({ name: s.name, parent: s.parent, di: s.displayIndex == null ? 0 : s.displayIndex, blend: s.blendMode || 'normal' }))
  const skin = {}; for (const sl of arm.skin[0].slot) skin[sl.name] = sl.display.map(dp => { const o = { type: dp.type || 'image', path: dp.path || dp.name, t: dp.transform || {} }; if (dp.type === 'mesh') { o.vertices = dp.vertices; o.uvs = dp.uvs; o.triangles = dp.triangles } return o })
  const anims = {}
  for (const an of arm.animation) { const bone = {}, slot = {}; if (an.bone) for (const bt of an.bone) bone[bt.name] = (bt.frame || []).map(f => ({ d: f.duration || 0, tw: f.tweenEasing, t: f.transform || {} })); if (an.slot) for (const st of an.slot) slot[st.name] = (st.frame || []).map(f => ({ d: f.duration || 0, tw: f.tweenEasing, di: f.displayIndex == null ? null : f.displayIndex, a: f.color && f.color.aM != null ? f.color.aM / 100 : 1 })); anims[an.name] = { dur: an.duration || 1, pt: an.playTimes == null ? 0 : an.playTimes, bone, slot } }
  return { type: 'db', atlas, sub, bones, slots, skin, anims, fps: ske.frameRate || 60 }
}

const out = {
  fengbaoleishen: Object.assign({ title: '风暴雷神', memberId: 1910 }, buildDB('z_leishen')),
  guazai_L15: Object.assign({ title: '挂载 L_15', model: 'L_15' }, buildCS('L_15')),
}
fs.writeFileSync(OUT, JSON.stringify(out))
console.log('written', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + 'MB')
console.log('fengbaoleishen anims:', Object.keys(out.fengbaoleishen.anims).join(','))
console.log('guazai_L15 anims:', Object.keys(out.guazai_L15.anims).join(','))
