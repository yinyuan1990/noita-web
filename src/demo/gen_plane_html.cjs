// 生成自包含的「飞机升级验证」HTML：真实配置表数值 + 真实图标(base64内嵌)
// 用法: node gen_plane_html.js
const fs = require('fs')
const path = require('path')

const ASSETS = 'E:\\soft\\xiaoshuodongtai\\ziyuan\\main\\assets'
const DATA = path.join(ASSETS, 'data')
const ICONDIR = path.join(ASSETS, 'membericon')
const OUT = path.join(__dirname, '飞机升级验证.html')

// ── GaMe(TEA) 资源解密 ────────────────────────────────
// 反汇编 libcocos2dcpp.so 得到：头5字节("GaMe"+flag)，其后 8字节分组 TEA，
// 16轮，delta=0x9E3779B9，key=hex解码16字节(小端4个uint32)，块小端。
const TEA_KEY_HEX = '46E330EAFAF5C3E09D4A95835704AD7C'
const TEA_KEY = (() => {
  const b = Buffer.from(TEA_KEY_HEX, 'hex')
  return [b.readUInt32LE(0), b.readUInt32LE(4), b.readUInt32LE(8), b.readUInt32LE(12)]
})()
const MOD = 0x100000000
function teaDecryptBody(body, k) {
  const out = Buffer.alloc(body.length)
  const DELTA = 0x9e3779b9
  for (let i = 0; i + 8 <= body.length; i += 8) {
    let v0 = body.readUInt32LE(i), v1 = body.readUInt32LE(i + 4)
    let sum = (DELTA * 16) % MOD
    for (let r = 0; r < 16; r++) {
      const a1 = ((((v0 << 4) >>> 0) + k[2]) % MOD) ^ ((v0 + sum) % MOD) ^ (((v0 >>> 5) + k[3]) % MOD)
      v1 = ((v1 - (a1 >>> 0)) % MOD + MOD) % MOD
      const a0 = ((((v1 << 4) >>> 0) + k[0]) % MOD) ^ ((v1 + sum) % MOD) ^ (((v1 >>> 5) + k[1]) % MOD)
      v0 = ((v0 - (a0 >>> 0)) % MOD + MOD) % MOD
      sum = ((sum - DELTA) % MOD + MOD) % MOD
    }
    out.writeUInt32LE(v0 >>> 0, i)
    out.writeUInt32LE(v1 >>> 0, i + 4)
  }
  return out
}
// 解密一个 GaMe 文件为原始字节(PNG等)；若不是GaMe则原样返回
function decryptAsset(buf) {
  if (buf.length < 6 || buf.toString('latin1', 0, 4) !== 'GaMe') return buf
  return teaDecryptBody(buf.slice(5), TEA_KEY)
}

function parseTbl(file) {
  let text = fs.readFileSync(path.join(DATA, file), 'utf16le').replace(/^\uFEFF/, '').replace(/\r/g, '')
  const lines = text.split('\n').filter(l => l.length)
  const keys = lines[1].split('\t')
  return lines.slice(3).map(line => {
    const cells = line.split('\t')
    const o = {}
    keys.forEach((k, i) => (o[k] = cells[i] ?? ''))
    return o
  })
}
function parseKV(s) {
  const o = {}
  if (!s) return o
  for (const seg of s.split('|')) {
    const [k, v] = seg.split(';')
    if (k !== undefined && v !== undefined) o[Number(k)] = Number(v)
  }
  return o
}

// ---- 飞机主表 ----
const memberRows = parseTbl('member.tbl')
const PLAYABLE = memberRows.filter(r => {
  const e = Number(r.ElemType)
  return e >= 1 && e <= 3 // 排除 99宝宝 / 100僚机
})

// ---- 等级曲线 ----
const levelRows = parseTbl('memberlevel.tbl')
const levelCurve = levelRows.map(r => ({
  lv: Number(r.Level),
  prop: parseKV(r.PropAll),
  needExp: Number(r.UpNeedExp),
  gold: Number(r.UpNeedGold),
  combat: Number(r.CombatPoint),
}))

// ---- 品质/突破 ----
const qualityRows = parseTbl('memberquality.tbl')
const quality = {}
for (const r of qualityRows) {
  const id = Number(r.MemberID)
  ;(quality[id] = quality[id] || []).push({
    q: Number(r.Quality),
    name: r.QualityDisplay,
    prop: parseKV(r.PropAll),
    gold: Number(r.QualityUpGold),
    pieceId: Number(r.QualityUpPiece),
    pieceNum: Number(r.QualityUpNumber),
    needLv: Number(r.QualityUpLevel),
  })
}

// ---- 星级 ----
const starRows = parseTbl('memberstar.tbl')
const star = {}
for (const r of starRows) {
  const id = Number(r.StarID)
  ;(star[id] = star[id] || []).push({
    s: Number(r.StarLevel),
    item1: parseKV(r.Item1),
    item2: parseKV(r.Item2),
    prop: parseKV(r.Prop),
    propMore: parseKV(r.PropMore),
  })
}

// ---- 品质段属性上限(在 membertech.tbl) ----
let qualityCap = []
try {
  const capRows = parseTbl('membertech.tbl')
  qualityCap = capRows
    .filter(r => r.MinQuality)
    .map(r => ({ min: Number(r.MinQuality), max: Number(r.MaxQuality), cap: parseKV(r.MaxTotalProp) }))
} catch (e) {}

// ---- 属性名 ----
const propRows = parseTbl('propname.tbl')
const propName = {}
for (const r of propRows) propName[Number(r.PropID)] = r.Name

// ---- 组装飞机列表 + 内嵌图标 ----
// assets 里的 png 都是 GaMe(TEA) 加密，这里解密后内嵌真实图标。
const planes = []
let iconOK = 0
for (const r of PLAYABLE) {
  const id = Number(r.MemberID)
  const iconId = r.IconID
  const pj = r.PingJia.split(';')
  let icon = ''
  const fp = path.join(ICONDIR, iconId + '.png')
  if (fs.existsSync(fp)) {
    const dec = decryptAsset(fs.readFileSync(fp))
    if (dec.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
      icon = 'data:image/png;base64,' + dec.toString('base64')
      iconOK++
    }
  }
  planes.push({
    id,
    name: r.Name.trim(),
    elem: Number(r.ElemType),
    star: Number(pj[1] || 1),
    propCoe: r.PropCoe,
    starTrack: Number(r.MemberStar),
    initQuality: Number(r.Quality),
    iconId: Number(iconId),
    icon,
    hasQuality: !!quality[id],
  })
}

const dataObj = { planes, levelCurve, quality, star, qualityCap, propName }
const dataJson = JSON.stringify(dataObj)

const html = buildHtml(dataJson)
fs.writeFileSync(OUT, html, 'utf8')
console.log('planes:', planes.length, ' levels:', levelCurve.length, ' qualityPlanes:', Object.keys(quality).length, ' starTracks:', Object.keys(star).length, ' caps:', qualityCap.length)
console.log('icons embedded:', planes.filter(p => p.icon).length)
console.log('written ->', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB')

function buildHtml(dataJson) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>飞机升级系统 · 验证</title>
<style>
  :root{--bg:#0a0e17;--panel:#121a2b;--panel2:#0f1626;--line:#243350;--txt:#dbe6f5;--sub:#8ba0c0;--gold:#ffce54;--dia:#5ac8fa;--hp:#ff6b81;--atk:#ffa24a;--def:#4ad991;--acc:#6ea8ff}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 700px at 70% -10%,#16233d 0,var(--bg) 60%);color:var(--txt);font:14px/1.5 "Microsoft YaHei",system-ui,sans-serif;min-height:100vh}
  h1{font-size:18px;margin:0}
  .top{display:flex;align-items:center;gap:16px;padding:14px 20px;border-bottom:1px solid var(--line);background:#0c1220cc;position:sticky;top:0;z-index:5;backdrop-filter:blur(6px)}
  .wallet{margin-left:auto;display:flex;gap:14px;font-size:13px}
  .wallet b{color:var(--gold)}
  .chip{background:#0e1728;border:1px solid var(--line);border-radius:20px;padding:5px 12px}
  .btn{cursor:pointer;border:1px solid var(--line);background:linear-gradient(180deg,#1b2740,#141d30);color:var(--txt);border-radius:8px;padding:8px 14px;font-size:13px;transition:.15s}
  .btn:hover{border-color:var(--acc);box-shadow:0 0 0 2px #6ea8ff22}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn.gold{border-color:#7a5c14;background:linear-gradient(180deg,#3a2f10,#241d08);color:var(--gold)}
  .wrap{display:grid;grid-template-columns:230px 1fr 300px;gap:16px;padding:16px 20px;max-width:1200px;margin:0 auto}
  .card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:14px;padding:14px}
  .title{font-size:12px;color:var(--sub);letter-spacing:2px;margin-bottom:10px;text-transform:uppercase}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:520px;overflow:auto}
  .pcell{cursor:pointer;border:1px solid var(--line);border-radius:10px;padding:6px;text-align:center;background:#0e1626;transition:.15s;position:relative}
  .pcell:hover{border-color:var(--acc)}
  .pcell.sel{border-color:var(--gold);box-shadow:0 0 0 2px #ffce5433}
  .pcell img{width:100%;display:block;border-radius:6px}
  .pcell .nm{font-size:11px;color:var(--sub);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stage{display:flex;flex-direction:column;align-items:center;gap:8px}
  .hero{width:230px;height:230px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 40%,#22406e55,transparent 70%);border-radius:20px}
  .hero img{max-width:200px;max-height:200px;filter:drop-shadow(0 8px 22px #000a);animation:bob 2.4s ease-in-out infinite}
  @keyframes bob{0%,100%{transform:translateY(-6px)}50%{transform:translateY(6px)}}
  .pname{font-size:22px;font-weight:700;letter-spacing:1px}
  .stars{color:var(--gold);letter-spacing:3px;font-size:18px}
  .qbadge{display:inline-block;background:#2a2140;border:1px solid #6f5cff55;color:#c9b8ff;border-radius:6px;padding:2px 10px;font-size:13px}
  .stat{display:flex;align-items:center;gap:10px;margin:8px 0}
  .stat .lab{width:52px;color:var(--sub);font-size:13px}
  .bar{flex:1;height:10px;background:#0c1424;border-radius:6px;overflow:hidden;border:1px solid var(--line)}
  .bar i{display:block;height:100%}
  .stat .val{width:78px;text-align:right;font-variant-numeric:tabular-nums}
  .combat{font-size:28px;font-weight:800;color:var(--gold);text-align:center;margin:6px 0}
  .row{display:flex;gap:8px;margin-top:10px}
  .row .btn{flex:1}
  .lvinfo{font-size:12px;color:var(--sub);text-align:center;margin-top:6px}
  .expbar{height:8px;background:#0c1424;border:1px solid var(--line);border-radius:5px;overflow:hidden;margin-top:8px}
  .expbar i{display:block;height:100%;background:linear-gradient(90deg,#3ea0ff,#7de3ff)}
  .cost{font-size:12px;color:var(--sub);margin-top:4px;text-align:center}
  .log{font-size:12px;color:var(--sub);max-height:120px;overflow:auto;margin-top:8px;border-top:1px dashed var(--line);padding-top:8px}
  .note{font-size:11px;color:#5f76a0;margin-top:10px;line-height:1.6}
</style>
</head>
<body>
<div class="top">
  <h1>✈ 飞机升级系统 · 验证台</h1>
  <span style="color:var(--sub);font-size:12px">数值+图标均来自反编译真实资源(GaMe/TEA已解密)</span>
  <div class="wallet">
    <span class="chip">经验 <b id="w-exp">0</b></span>
    <span class="chip">金币 <b id="w-gold">0</b></span>
    <span class="chip">钻石 <b id="w-dia">0</b></span>
    <span class="chip">材料 <b id="w-mat">0</b></span>
    <button class="btn gold" onclick="cheat()">+资源(测试)</button>
  </div>
</div>

<div class="wrap">
  <div class="card">
    <div class="title">选择战机</div>
    <div class="grid" id="planeGrid"></div>
  </div>

  <div class="card stage">
    <div class="hero"><img id="heroImg" alt=""/></div>
    <div class="pname" id="pName">—</div>
    <div><span class="stars" id="pStars"></span> &nbsp; <span class="qbadge" id="pQuality">—</span></div>
    <div class="lvinfo">等级 <b id="pLevel" style="color:var(--txt)">1</b> / 500</div>
    <div class="expbar"><i id="expFill" style="width:0"></i></div>
    <div class="cost" id="expCost"></div>
    <div class="row">
      <button class="btn" id="btnLv1" onclick="doLevel(1)">升 1 级</button>
      <button class="btn" id="btnLv10" onclick="doLevel(10)">升 10 级</button>
    </div>
    <div class="row">
      <button class="btn" id="btnQ" onclick="doQuality()">品质突破</button>
      <button class="btn" id="btnS" onclick="doStar()">升 星</button>
    </div>
    <div class="cost" id="upCost"></div>
  </div>

  <div class="card">
    <div class="title">属性面板</div>
    <div class="combat" id="combat">0</div>
    <div style="text-align:center;color:var(--sub);font-size:12px;margin-bottom:6px">战斗力</div>
    <div class="stat"><span class="lab">生命</span><div class="bar"><i id="barHp" style="background:var(--hp)"></i></div><span class="val" id="valHp">0</span></div>
    <div class="stat"><span class="lab">攻击</span><div class="bar"><i id="barAtk" style="background:var(--atk)"></i></div><span class="val" id="valAtk">0</span></div>
    <div class="stat"><span class="lab">防御</span><div class="bar"><i id="barDef" style="background:var(--def)"></i></div><span class="val" id="valDef">0</span></div>
    <div class="title" style="margin-top:16px">操作日志</div>
    <div class="log" id="log"></div>
    <div class="note">说明：升级=吃经验+金币；突破=金币+碎片(材料代替)且需达等级门槛；升星=材料。数值均按真实配置表；属性受品质段上限裁剪。</div>
  </div>
</div>

<script>
const DATA = ${dataJson};
const PNAME = DATA.propName;

// 存档（每架飞机独立）
const saves = {};
function getSave(id){
  if(!saves[id]){
    const p = DATA.planes.find(x=>x.id===id);
    saves[id] = { level:1, quality:p.initQuality, star:0, exp:0 };
  }
  return saves[id];
}
let wallet = { exp:0, gold:0, dia:0, mat:0 };
let curId = DATA.planes[0].id;

function levelRow(lv){ return DATA.levelCurve.find(r=>r.lv===lv) || DATA.levelCurve[DATA.levelCurve.length-1]; }
function qList(id){ return DATA.quality[id] || []; }
function qRow(id,q){ return qList(id).find(r=>r.q===q); }
function nextQ(id,q){ const l=qList(id); const i=l.findIndex(r=>r.q===q); return i>=0 && i<l.length-1 ? l[i+1] : null; }
function starList(track){ return DATA.star[track] || []; }
function starRow(track,s){ return starList(track).find(r=>r.s===s); }

function addProp(acc,kv){ for(const k in kv) acc[k]=(acc[k]||0)+kv[k]; }

function computeStats(id){
  const s = getSave(id);
  const p = DATA.planes.find(x=>x.id===id);
  const acc = {1:0,3:0,4:0};
  const lr = levelRow(s.level); if(lr) addProp(acc,lr.prop);
  const qr = qRow(id,s.quality); if(qr) addProp(acc,qr.prop);
  const sr = starRow(p.starTrack,s.star); if(sr){ addProp(acc,sr.prop); addProp(acc,sr.propMore||{}); }
  // 品质段上限裁剪
  const cap = DATA.qualityCap.find(c=>s.quality>=c.min && s.quality<=c.max);
  if(cap) for(const k in cap.cap) if(acc[k]!=null) acc[k]=Math.min(acc[k],cap.cap[k]);
  const combat = (lr?lr.combat:0);
  return { acc, combat, plane:p, save:s };
}

function log(msg,ok=true){
  const el=document.getElementById('log');
  const d=document.createElement('div');
  d.style.color = ok?'#9fd39f':'#ff8b8b';
  d.textContent = '· '+msg;
  el.prepend(d);
}

function fmt(n){ return n>=10000 ? (n/10000).toFixed(1)+'万' : n; }

function renderGrid(){
  const g=document.getElementById('planeGrid'); g.innerHTML='';
  for(const p of DATA.planes){
    const d=document.createElement('div');
    d.className='pcell'+(p.id===curId?' sel':'');
    d.onclick=()=>{curId=p.id;render();};
    d.innerHTML=(p.icon?('<img src="'+p.icon+'"/>'):'<div style="height:60px"></div>')+'<div class="nm">'+p.name+'</div>';
    g.appendChild(d);
  }
}

function render(){
  renderGrid();
  const {acc,combat,plane,save} = computeStats(curId);
  document.getElementById('heroImg').src = plane.icon||'';
  document.getElementById('pName').textContent = plane.name;
  document.getElementById('pStars').textContent = '★'.repeat(Math.min(plane.star,9));
  const qr = qRow(curId,save.quality);
  document.getElementById('pQuality').textContent = qr?qr.name:('品质'+save.quality);
  document.getElementById('pLevel').textContent = save.level;

  const lr = levelRow(save.level);
  const needExp = lr?lr.needExp:0;
  document.getElementById('expFill').style.width = needExp?Math.min(100,save.exp/needExp*100)+'%':'100%';
  document.getElementById('expCost').textContent = save.level>=500?'已满级':('升级需 经验'+needExp+' · 金币'+lr.gold+'　(当前经验 '+save.exp+')');

  document.getElementById('combat').textContent = fmt(combat);
  const maxRef = {1:250000,3:50000,4:50000};
  const set=(bar,val,pid)=>{document.getElementById(val).textContent=fmt(acc[pid]||0);document.getElementById(bar).style.width=Math.min(100,(acc[pid]||0)/maxRef[pid]*100)+'%';};
  set('barHp','valHp',1); set('barAtk','valAtk',3); set('barDef','valDef',4);

  // 突破/升星按钮状态
  const nq = nextQ(curId,save.quality);
  const btnQ=document.getElementById('btnQ');
  if(!nq){ btnQ.disabled=true; btnQ.textContent='品质已满'; }
  else { btnQ.disabled=false; btnQ.textContent='突破→'+nq.name; }
  const ns = starRow(plane.starTrack,save.star+1);
  const btnS=document.getElementById('btnS');
  if(!ns){ btnS.disabled=true; btnS.textContent='星级已满'; }
  else { btnS.disabled=false; btnS.textContent='升星 '+save.star+'→'+(save.star+1); }

  let costTxt='';
  if(nq) costTxt+='突破需 金币'+nq.gold+' + 碎片'+nq.pieceNum+'(材料) · 需等级'+nq.needLv+'；';
  if(ns){ const need=Object.values(ns.item2)[0]||0; costTxt+='升星需 材料'+need; }
  document.getElementById('upCost').textContent=costTxt;

  document.getElementById('w-exp').textContent=fmt(wallet.exp);
  document.getElementById('w-gold').textContent=fmt(wallet.gold);
  document.getElementById('w-dia').textContent=fmt(wallet.dia);
  document.getElementById('w-mat').textContent=fmt(wallet.mat);
}

function doLevel(n){
  const s=getSave(curId);
  let done=0;
  for(let i=0;i<n;i++){
    if(s.level>=500){break;}
    const lr=levelRow(s.level);
    if(wallet.exp<lr.needExp){ log('经验不足，还需 '+(lr.needExp-wallet.exp),false); break; }
    if(wallet.gold<lr.gold){ log('金币不足',false); break; }
    wallet.exp-=lr.needExp; wallet.gold-=lr.gold; s.level++; done++;
  }
  if(done)log('升级 +'+done+' → '+s.level+' 级');
  render();
}
function doQuality(){
  const s=getSave(curId);
  const nq=nextQ(curId,s.quality);
  if(!nq)return;
  if(s.level<nq.needLv){ log('突破需等级 '+nq.needLv+'，当前 '+s.level,false); return; }
  if(wallet.gold<nq.gold){ log('金币不足(需'+nq.gold+')',false); return; }
  if(wallet.mat<nq.pieceNum){ log('碎片/材料不足(需'+nq.pieceNum+')',false); return; }
  wallet.gold-=nq.gold; wallet.mat-=nq.pieceNum; s.quality=nq.q;
  log('品质突破 → '+nq.name);
  render();
}
function doStar(){
  const s=getSave(curId);
  const p=DATA.planes.find(x=>x.id===curId);
  const ns=starRow(p.starTrack,s.star+1);
  if(!ns)return;
  const need=Object.values(ns.item2)[0]||0;
  if(wallet.mat<need){ log('材料不足(需'+need+')',false); return; }
  wallet.mat-=need; s.star++;
  log('升星 → '+s.star+' 星');
  render();
}
function cheat(){ wallet.exp+=100000; wallet.gold+=500000; wallet.dia+=5000; wallet.mat+=2000; log('补充测试资源'); render(); }

render();
</script>
</body>
</html>`
}
