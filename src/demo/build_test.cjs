// 生成自包含测试页 skeleton_test.html：内联 skeleton_player.js + skeleton_models.json
const fs = require('fs'); const path = require('path')
let mod = fs.readFileSync(path.join(__dirname, 'skeleton_player.js'), 'utf8')
mod = mod.replace(/^export\s+class\s+SkeletonPlayer/m, 'class SkeletonPlayer')
        .replace(/if \(typeof window[\s\S]*$/m, '')
        .replace(/export default SkeletonPlayer\s*/m, '')
const json = fs.readFileSync(path.join(__dirname, 'skeleton_models.json'), 'utf8')
const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><title>骨骼对接自测</title>
<style>body{margin:0;background:#0a0e17;color:#dbe6f5;font:14px "Microsoft YaHei",sans-serif}
.wrap{display:flex;gap:24px;padding:20px;justify-content:center}
.col{display:flex;flex-direction:column;align-items:center;gap:10px}
canvas{background:radial-gradient(circle at 50% 45%,#1a3056aa,transparent 70%);border-radius:14px}
.btn{cursor:pointer;border:1px solid #2a3a5a;background:#141d30;color:#dbe6f5;border-radius:8px;padding:5px 10px;margin:2px}
.btn.sel{border-color:#ffce54;color:#ffce54}h3{margin:6px}</style></head>
<body><div class="wrap">
<div class="col"><h3>风暴雷神 (fengbaoleishen)</h3><canvas id="c1" width="440" height="560"></canvas><div id="a1"></div></div>
<div class="col"><h3>挂载 L_15 (guazai_L15)</h3><canvas id="c2" width="360" height="460"></canvas><div id="a2"></div></div>
</div>
<script>
const DB=${json};
${mod}
async function setup(key,cvId,btnId,w,h){
 const p=new SkeletonPlayer(DB[key],{width:w,height:h,fps:30,scale:1.0}); await p.load();
 const dst=document.getElementById(cvId).getContext('2d');
 const bar=document.getElementById(btnId);
 function rb(){bar.innerHTML='';for(const n of p.animations()){const b=document.createElement('span');b.className='btn'+(n===p.anim?' sel':'');b.textContent=n;b.onclick=()=>{p.setAnimation(n);rb();};bar.appendChild(b);} }
 rb();
 function loop(now){p.render(now/1000);dst.clearRect(0,0,w,h);dst.drawImage(p.canvas,0,0);requestAnimationFrame(loop);}
 requestAnimationFrame(loop);
}
setup('fengbaoleishen','c1','a1',440,560);
setup('guazai_L15','c2','a2',360,460);
</script></body></html>`
fs.writeFileSync(path.join(__dirname, 'skeleton_test.html'), html)
console.log('written skeleton_test.html', (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + 'MB')
