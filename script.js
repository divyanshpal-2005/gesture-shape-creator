const video         = document.getElementById('video');
const canvas        = document.getElementById('canvas');
const ctx           = canvas.getContext('2d');
const statusDot     = document.getElementById('status-dot');
const statusText    = document.getElementById('status-text');
const gestureVal    = document.getElementById('gesture-val');
const objCountEl    = document.getElementById('obj-count');
const fpsEl         = document.getElementById('fps-val');
const shapeVal      = document.getElementById('shape-val');
const shapeColorDot = document.getElementById('shape-color-dot');
const drawColorDot  = document.getElementById('draw-color-dot');
const confBar       = document.getElementById('conf-bar');
const confValEl     = document.getElementById('conf-val');
const sizeSlider    = document.getElementById('sizeSlider');
const sizeValEl     = document.getElementById('size-val');
const sizeHudEl     = document.getElementById('size-hud');
const undoBtn       = document.getElementById('undo-btn');
const undoDrawBtn   = document.getElementById('undo-draw-btn');
const clearBtn      = document.getElementById('clear-btn');
const toast         = document.getElementById('toast');
const gestureAnnounce = document.getElementById('gesture-announce');

let objects = [], grabbed = null, drawings = [], currentPath = [], isDrawing = false;
let palmX = 0, palmY = 0, handVelX = 0, handVelY = 0;
let lastTs = performance.now(), frameCount = 0;
let lastGesture = null, panelsHidden = false;
let lastSpawnTime = 0;
const SPAWN_COOLDOWN = 600;

const SHAPE_LIST = ['sphere','cube','cone','star','diamond','hexagon','ring','cross'];
let selectedShapeIdx = 0, selectedShapeColor = '#06b6d4', drawColor = '#ff00ff', shapeSize = 56;

document.getElementById('splash-start').addEventListener('click', () => {
  document.getElementById('splash').classList.add('hidden');
  init();
});
document.getElementById('retry-btn').addEventListener('click', () => {
  document.getElementById('cam-error').classList.remove('show');
  init();
});
document.getElementById('help-btn').addEventListener('click', () => {
  document.getElementById('splash').classList.remove('hidden');
});

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function announceGesture(label, color) {
  gestureAnnounce.textContent = label;
  gestureAnnounce.style.color = color;
  gestureAnnounce.style.background = color + '22';
  gestureAnnounce.style.border = `0.5px solid ${color}55`;
  gestureAnnounce.style.animation = 'none';
  void gestureAnnounce.offsetWidth;
  gestureAnnounce.style.animation = 'gesture-flash 0.8s ease-out forwards';
}

sizeSlider.addEventListener('input', () => {
  shapeSize = parseInt(sizeSlider.value);
  sizeValEl.textContent = shapeSize + 'px';
  sizeHudEl.textContent = shapeSize;
});

function setupColorSwatches(containerId, onChange) {
  document.getElementById(containerId).querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.getElementById(containerId).querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      onChange(sw.dataset.color);
    });
  });
}
function setShapeColor(c) { selectedShapeColor = c; shapeColorDot.style.background = c; document.getElementById('customShapeColor').value = c; }
function setDrawColor(c)  { drawColor = c; drawColorDot.style.background = c; document.getElementById('customDrawColor').value = c; }
setupColorSwatches('shapeSwatches', setShapeColor);
setupColorSwatches('drawSwatches', setDrawColor);
document.getElementById('customShapeColor').addEventListener('input', e => { document.querySelectorAll('#shapeSwatches .swatch').forEach(s=>s.classList.remove('active')); setShapeColor(e.target.value); });
document.getElementById('customDrawColor').addEventListener('input', e => { document.querySelectorAll('#drawSwatches .swatch').forEach(s=>s.classList.remove('active')); setDrawColor(e.target.value); });
shapeColorDot.style.background = selectedShapeColor;
drawColorDot.style.background  = drawColor;

function updateShapeUI() {
  document.querySelectorAll('.shape-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.shape === SHAPE_LIST[selectedShapeIdx]));
  shapeVal.textContent = SHAPE_LIST[selectedShapeIdx].toUpperCase();
}
document.querySelectorAll('.shape-btn').forEach(btn => {
  btn.addEventListener('click', () => { selectedShapeIdx = SHAPE_LIST.indexOf(btn.dataset.shape); updateShapeUI(); });
});
updateShapeUI();

function updateUndoState() {
  undoBtn.disabled = objects.length === 0;
  undoDrawBtn.disabled = drawings.length === 0;
}
undoBtn.addEventListener('click', () => { if (objects.length) { objects.pop(); showToast('↩ Object removed'); updateUndoState(); } });
undoDrawBtn.addEventListener('click', () => { if (drawings.length) { drawings.pop(); showToast('✏ Stroke removed'); updateUndoState(); } });
clearBtn.addEventListener('click', () => { objects=[]; drawings=[]; currentPath=[]; showToast('🗑 Canvas cleared'); updateUndoState(); });

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey||e.metaKey) && e.key==='z') { if(objects.length){objects.pop();showToast('↩ Undo');updateUndoState();} }
  if (e.key==='c'||e.key==='C') { objects=[]; drawings=[]; currentPath=[]; showToast('🗑 Cleared'); updateUndoState(); }
  if (e.key==='ArrowRight') { selectedShapeIdx=(selectedShapeIdx+1)%SHAPE_LIST.length; updateShapeUI(); showToast('Shape: '+SHAPE_LIST[selectedShapeIdx].toUpperCase()); }
  if (e.key==='ArrowLeft')  { selectedShapeIdx=(selectedShapeIdx-1+SHAPE_LIST.length)%SHAPE_LIST.length; updateShapeUI(); showToast('Shape: '+SHAPE_LIST[selectedShapeIdx].toUpperCase()); }
  if (e.key==='h'||e.key==='H') {
    panelsHidden = !panelsHidden;
    document.querySelector('.left-panel').style.display = panelsHidden ? 'none' : '';
    document.querySelector('.right-panel').style.display = panelsHidden ? 'none' : '';
    showToast(panelsHidden ? 'Panels hidden' : 'Panels shown');
  }
});

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight - 54; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function classify(lm) {
  if (!lm||lm.length<21) return null;
  const iU=lm[8].y<lm[6].y, mU=lm[12].y<lm[10].y, rU=lm[16].y<lm[14].y, pU=lm[20].y<lm[18].y;
  if (iU&&mU&&!rU&&!pU) return 'peace';
  if (iU&&!mU&&!rU&&!pU) return 'point';
  if (!iU&&!mU&&!rU&&!pU) return 'fist';
  if (iU&&mU&&rU&&pU) return 'open';
  return null;
}

function spawnObject(x, y) {
  const now = performance.now();
  if (now - lastSpawnTime < SPAWN_COOLDOWN) return;
  lastSpawnTime = now;
  const type = SHAPE_LIST[selectedShapeIdx];
  objects.push({ type, x, y, color: selectedShapeColor, size: shapeSize, vx:(Math.random()-.5)*3.5, vy:-4.2, rot:Math.random()*Math.PI*2, rotSpeed:(Math.random()-.5)*0.09, age:0 });
  updateUndoState();
  const flash = document.createElement('div');
  flash.className = 'spawn-flash';
  const fs = shapeSize;
  flash.style.cssText = `left:${x-fs/2}px;top:${y+22+54}px;width:${fs}px;height:${fs}px;background:${selectedShapeColor}44;border:3px solid ${selectedShapeColor};`;
  document.body.appendChild(flash);
  setTimeout(()=>flash.remove(), 700);
  announceGesture(type.toUpperCase(), selectedShapeColor);
}

function starPath(ctx,r,n) {
  const inner=r*0.42; ctx.beginPath();
  for(let i=0;i<n*2;i++){const a=(i*Math.PI)/n-Math.PI/2,rad=i%2===0?r:inner;i===0?ctx.moveTo(Math.cos(a)*rad,Math.sin(a)*rad):ctx.lineTo(Math.cos(a)*rad,Math.sin(a)*rad);}
  ctx.closePath();
}
function hexPath(ctx,r) {
  ctx.beginPath();
  for(let i=0;i<6;i++){const a=(Math.PI/3)*i-Math.PI/6;i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}
  ctx.closePath();
}

function drawObject(o) {
  const rawSize=o.size||56, scale=Math.min(1,o.age/12), s=rawSize*scale, alpha=scale*0.94;
  ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.rot||0); ctx.globalAlpha=alpha;
  const c=o.color, c2=c+'55', c3=c+'88';
  switch(o.type) {
    case 'sphere': {
      const g=ctx.createRadialGradient(-s*.3,-s*.3,s*.15,0,0,s*.7);
      g.addColorStop(0,c+'ff'); g.addColorStop(1,c+'22');
      ctx.fillStyle=g; ctx.shadowColor=c; ctx.shadowBlur=28;
      ctx.beginPath(); ctx.arc(0,0,s/2,0,Math.PI*2); ctx.fill(); break;
    }
    case 'cube': {
      ctx.fillStyle=c2; ctx.strokeStyle=c; ctx.lineWidth=2;
      ctx.fillRect(-s/2,-s/2,s,s); ctx.strokeRect(-s/2,-s/2,s,s);
      const off=s*.22; ctx.strokeStyle=c+'aa';
      ctx.beginPath();
      ctx.moveTo(-s/2,-s/2);ctx.lineTo(-s/2-off,-s/2-off);
      ctx.moveTo(s/2,-s/2);ctx.lineTo(s/2-off,-s/2-off);
      ctx.moveTo(s/2,s/2);ctx.lineTo(s/2-off,s/2-off);
      ctx.moveTo(-s/2-off,-s/2-off);ctx.lineTo(s/2-off,-s/2-off);
      ctx.moveTo(s/2-off,-s/2-off);ctx.lineTo(s/2-off,s/2-off);
      ctx.stroke(); break;
    }
    case 'cone': {
      ctx.fillStyle=c3; ctx.strokeStyle=c; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(0,-s*.75); ctx.lineTo(-s*.45,s*.4); ctx.lineTo(s*.45,s*.4); ctx.closePath();
      ctx.fill(); ctx.stroke(); break;
    }
    case 'star': {
      ctx.fillStyle=c3; ctx.strokeStyle=c; ctx.lineWidth=2; ctx.shadowColor=c; ctx.shadowBlur=18;
      starPath(ctx,s/2,5); ctx.fill(); ctx.stroke(); break;
    }
    case 'diamond': {
      ctx.fillStyle=c2; ctx.strokeStyle=c; ctx.lineWidth=2; ctx.shadowColor=c; ctx.shadowBlur=20;
      ctx.beginPath(); ctx.moveTo(0,-s*.6); ctx.lineTo(s*.38,0); ctx.lineTo(0,s*.6); ctx.lineTo(-s*.38,0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle=c+'cc'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(0,-s*.6);ctx.lineTo(s*.38,0); ctx.moveTo(0,-s*.6);ctx.lineTo(-s*.38,0); ctx.stroke(); break;
    }
    case 'hexagon': {
      ctx.fillStyle=c2; ctx.strokeStyle=c; ctx.lineWidth=2; ctx.shadowColor=c; ctx.shadowBlur=16;
      hexPath(ctx,s/2); ctx.fill(); ctx.stroke(); break;
    }
    case 'ring': {
      ctx.strokeStyle=c; ctx.lineWidth=s*.14; ctx.shadowColor=c; ctx.shadowBlur=24;
      ctx.beginPath(); ctx.arc(0,0,s/2-ctx.lineWidth/2,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=alpha*.3; ctx.strokeStyle=c+'aa'; ctx.lineWidth=s*.06;
      ctx.beginPath(); ctx.arc(0,0,s/2*.55,0,Math.PI*2); ctx.stroke(); break;
    }
    case 'cross': {
      ctx.fillStyle=c3; ctx.strokeStyle=c; ctx.lineWidth=2; ctx.shadowColor=c; ctx.shadowBlur=14;
      const arm=s*.22, len=s*.5;
      ctx.beginPath(); ctx.rect(-arm,-len,arm*2,len*2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(-len,-arm,len*2,arm*2); ctx.fill(); ctx.stroke(); break;
    }
  }
  ctx.restore();
}

const CONNECTIONS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(lm) {
  const W=canvas.width,H=canvas.height;
  ctx.save(); ctx.strokeStyle='rgba(6,182,212,0.5)'; ctx.lineWidth=2.5;
  CONNECTIONS.forEach(([a,b])=>{ctx.beginPath();ctx.moveTo((1-lm[a].x)*W,lm[a].y*H);ctx.lineTo((1-lm[b].x)*W,lm[b].y*H);ctx.stroke();});
  lm.forEach((pt,i)=>{const px=(1-pt.x)*W,py=pt.y*H;ctx.beginPath();ctx.arc(px,py,i===0?5:3,0,Math.PI*2);ctx.fillStyle=i===8?(isDrawing?drawColor:'#ffffff'):'rgba(6,182,212,0.7)';ctx.fill();});
  ctx.restore();
}

function drawFreehand() {
  [...drawings,...(currentPath.length>1?[currentPath]:[])].forEach(path=>{
    if(path.length<2) return;
    ctx.save(); ctx.strokeStyle=path.color||drawColor; ctx.lineWidth=6; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.shadowColor=path.color||drawColor; ctx.shadowBlur=10;
    ctx.beginPath(); ctx.moveTo(path[0].x,path[0].y);
    for(let i=1;i<path.length;i++) ctx.lineTo(path[i].x,path[i].y);
    ctx.stroke(); ctx.restore();
  });
}

function render(landmarksArray, conf) {
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  frameCount++;
  const now=performance.now();
  fpsEl.textContent = Math.round(1000/Math.max(1,now-lastTs));
  lastTs = now;

  const dc = Math.round((conf||0)*100);
  confValEl.textContent = dc+'%';
  confBar.style.width = dc+'%';
  confBar.style.background = dc>70?'var(--accent-green)':dc>40?'#f59e0b':'var(--accent-red)';

  if (landmarksArray && landmarksArray.length>0) {
    const lm=landmarksArray[0];
    drawHand(lm);
    const tipX=(1-lm[8].x)*W, tipY=lm[8].y*H;
    const nPX=(1-lm[0].x)*W, nPY=lm[0].y*H;
    handVelX=palmX?nPX-palmX:0; handVelY=palmY?nPY-palmY:0;
    palmX=nPX; palmY=nPY;
    const gesture=classify(lm);

    if (gesture==='point') {
      isDrawing=true; currentPath.push({x:tipX,y:tipY});
      gestureVal.textContent="DRAWING"; statusDot.style.background=drawColor;
      document.getElementById('pill-mode').classList.add('active');
    } else {
      if (isDrawing&&currentPath.length>3) {
        const saved=currentPath.map(p=>({...p})); saved.color=drawColor;
        drawings.push(saved); updateUndoState();
      }
      currentPath=[]; isDrawing=false;
      document.getElementById('pill-mode').classList.remove('active');
    }

    if (gesture==='fist') {
      if (!grabbed) {
        let closest=null,minDist=Infinity;
        for(let o of objects){const d=Math.hypot(o.x-palmX,o.y-palmY);if(d<minDist&&d<130){minDist=d;closest=o;}}
        if(closest) grabbed=closest;
      }
      if(grabbed){grabbed.x=palmX;grabbed.y=palmY;}
      gestureVal.textContent=grabbed?"GRABBING":"FIST";
    } else if(grabbed&&(gesture==='open'||gesture===null)) {
      grabbed.vx=handVelX*6; grabbed.vy=handVelY*6; grabbed=null;
      gestureVal.textContent="THROW!";
    } else if(gesture==='open') {
      spawnObject(palmX,palmY);
      gestureVal.textContent=SHAPE_LIST[selectedShapeIdx].toUpperCase();
    } else if(gesture==='peace') {
      if(lastGesture!=='peace') {
        objects=[]; drawings=[]; currentPath=[]; updateUndoState();
        gestureVal.textContent="CLEARED";
        announceGesture("✌ CLEARED","#10b981");
      }
    }

    lastGesture=gesture;
    statusDot.style.background=grabbed?"#ec4899":isDrawing?drawColor:"#10b981";
    statusText.textContent=grabbed?"OBJECT GRABBED":isDrawing?"Drawing Mode":"Hand Detected";
  } else {
    if(isDrawing&&currentPath.length>3){const saved=currentPath.map(p=>({...p}));saved.color=drawColor;drawings.push(saved);updateUndoState();}
    currentPath=[]; isDrawing=false;
    if(grabbed){grabbed.vx=handVelX*5;grabbed.vy=handVelY*5;grabbed=null;}
    lastGesture=null;
    statusDot.style.background="#f59e0b"; statusText.textContent="Show your hand"; gestureVal.textContent="READY";
  }

  objects=objects.filter(o=>o.age<420);
  objects.forEach(o=>{
    if(o!==grabbed){
      o.age++; o.x+=o.vx; o.y+=o.vy; o.vy+=0.09; o.vx*=0.998; o.rot+=o.rotSpeed||0;
      const sz=(o.size||56)/2;
      if(o.x<sz){o.x=sz;o.vx=Math.abs(o.vx)*.6;}
      if(o.x>W-sz){o.x=W-sz;o.vx=-Math.abs(o.vx)*.6;}
      if(o.y>H-sz){o.y=H-sz;o.vy=-Math.abs(o.vy)*.65;}
    }
    drawObject(o);
  });

  drawFreehand();
  objCountEl.textContent=objects.length;
}

async function init() {
  statusText.textContent = 'Requesting camera…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}} });
    video.srcObject=stream; await video.play();
    document.getElementById('cam-badge').classList.add('live');
    const hands=new Hands({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`});
    hands.setOptions({maxNumHands:1,modelComplexity:1,minDetectionConfidence:0.75,minTrackingConfidence:0.7});
    hands.onResults(r=>render(r.multiHandLandmarks||[],r.multiHandedness?.[0]?.score||0));
    const cam=new Camera(video,{onFrame:async()=>await hands.send({image:video}),width:1280,height:720});
    cam.start();
    statusDot.style.background='#10b981'; statusText.textContent='Camera active';
  } catch(err) {
    console.error(err);
    statusDot.style.background='#ef4444'; statusText.textContent='Camera access required';
    document.getElementById('cam-error').classList.add('show');
  }
}

updateUndoState();
