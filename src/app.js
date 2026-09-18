import { makeMaterial, creepEquivalentModulus, buildModel, solveStatic, firstMode, modelMetrics, beamAnalytical, deformedElementPoints } from './solver.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const svg = $('#simSvg');
const state = { example:'beam', model:null, result:null, mode:null, metrics:null, raf:null, lastSolveToken:0, loadByExample:{beam:0.2,crossed:20,parallelogram:1} };

const ui = {
  length:$('#length'), thickness:$('#thickness'), width:$('#width'), spacing:$('#spacing'), mesh:$('#mesh'), material:$('#material'), load:$('#load'), deformScale:$('#deformScale'), animateMode:$('#animateMode'), creepEnabled:$('#creepEnabled'), creepTime:$('#creepTime'),
  lengthOut:$('#lengthOut'), thicknessOut:$('#thicknessOut'), widthOut:$('#widthOut'), spacingOut:$('#spacingOut'), meshOut:$('#meshOut'), loadOut:$('#loadOut'), scaleOut:$('#scaleOut'),
  loadLabel:$('#loadLabel'), spacingField:$('#spacingField'), solverPill:$('#solverPill'), sceneTitle:$('#sceneTitle'), sceneSubtitle:$('#sceneSubtitle'), exampleHelp:$('#exampleHelp'), theoryText:$('#theoryText'), validationContent:$('#validationContent'), warningText:$('#warningText'), interactionHint:$('#interactionHint'), creepPanel:$('#creepPanel'), creepTimeOut:$('#creepTimeOut'), creepModelNote:$('#creepModelNote'), creepEffE:$('#creepEffE'), creepFactor:$('#creepFactor'),
  dispMetric:$('#dispMetric'), stressMetric:$('#stressMetric'), freqMetric:$('#freqMetric'), stiffMetric:$('#stiffMetric'), stiffnessLabel:$('#stiffnessLabel'), eValue:$('#eValue'), rhoValue:$('#rhoValue'),
};

const exampleText = {
  beam: {
    title:'Resonating cantilever', subtitle:'large-rotation static solve + first linear mode',
    help:'A clamped-free leaf beam. The static tip-force solution and first bending eigenmode can be checked against closed-form Euler–Bernoulli results.',
    theory:'Each leaf is discretized into 2-node frame elements. The corotational formulation removes rigid-body translation/rotation from each element before computing axial and bending strain energy.',
  },
  crossed: {
    title:'Crossed-beam flexure hinge', subtitle:'two crossing leaves, mechanically unjoined at the crossing',
    help:'Two leaf springs cross geometrically but are not connected at the intersection. A stiff moving stage joins their right ends; a torque rotates the stage around the virtual pivot.',
    theory:'The two crossing beams are separate FEM chains: their centerlines may intersect without sharing a node. This captures the defining cross-spring topology; v1 does not model contact or the small out-of-plane offset used to physically pass one leaf over the other.',
  },
  parallelogram: {
    title:'Parallelogram flexure stage', subtitle:'paired leaves suppress stage rotation',
    help:'Two parallel leaf springs connect ground to a comparatively stiff output stage. A vertical force translates the stage while the paired geometry strongly suppresses rotation.',
    theory:'Both leaves are elastic beam chains and the output bar is modeled as a much thicker member of the same material. Its finite stiffness and mass remain in the model instead of being drawn as an infinitely rigid graphic.',
  },
};

function params(){
  const mat=makeMaterial(ui.material.value);
  const creepSeconds=ui.creepEnabled?.checked ? creepSecondsFromSlider(+ui.creepTime.value) : 0;
  const creep=creepEquivalentModulus(mat, creepSeconds);
  return {
    length:+ui.length.value/1000,
    thickness:+ui.thickness.value/1000,
    width:+ui.width.value/1000,
    spacing:+ui.spacing.value/1000,
    mesh:+ui.mesh.value,
    load: state.example==='crossed' ? +ui.load.value/1000 : +ui.load.value,
    E:creep.E, rho:mat.rho, material:mat, creepSeconds, creep,
  };
}

function configureForExample(){
  const e=state.example, t=exampleText[e];
  ui.sceneTitle.textContent=t.title; ui.sceneSubtitle.textContent=t.subtitle; ui.exampleHelp.textContent=t.help; ui.theoryText.textContent=t.theory;
  ui.spacingField.classList.toggle('hidden',e==='beam');
  ui.stiffnessLabel.textContent=e==='crossed'?'Rotational stiffness':'Output stiffness';
  if(e==='beam'){
    ui.load.min='-8';ui.load.max='8';ui.load.step='0.1';
  } else if(e==='crossed'){
    ui.load.min='-1000';ui.load.max='1000';ui.load.step='10';
  } else {
    ui.load.min='-20';ui.load.max='20';ui.load.step='0.25';
  }
  ui.load.value=state.loadByExample[e];
  syncOutputs();
}

function syncOutputs(){
  const p=params();
  ui.lengthOut.textContent=`${(+ui.length.value).toFixed(0)} mm`;
  ui.thicknessOut.textContent=`${(+ui.thickness.value).toFixed(2)} mm`;
  ui.widthOut.textContent=`${(+ui.width.value).toFixed(1)} mm`;
  ui.spacingOut.textContent=`${(+ui.spacing.value).toFixed(0)} mm`;
  ui.meshOut.textContent=`${ui.mesh.value} / leaf`;
  ui.scaleOut.textContent=`${(+ui.deformScale.value).toFixed(2)}×`;
  ui.loadOut.textContent=state.example==='crossed'?`${(+ui.load.value).toFixed(0)} N·mm`:`${(+ui.load.value).toFixed(2)} N`;
  ui.eValue.textContent=`${(p.material.E/1e9).toFixed(2)} GPa`;
  ui.rhoValue.textContent=`${p.rho.toFixed(0)} kg/m³`;
  const hasCreep=!!p.material.creep;
  ui.creepPanel?.classList.toggle('disabled-panel',!hasCreep);
  if(ui.creepEnabled){ ui.creepEnabled.disabled=!hasCreep; if(!hasCreep) ui.creepEnabled.checked=false; }
  if(ui.creepTime) ui.creepTime.disabled=!hasCreep || !ui.creepEnabled.checked;
  if(ui.creepTimeOut) ui.creepTimeOut.textContent=formatDuration(p.creepSeconds);
  if(ui.creepEffE) ui.creepEffE.textContent=hasCreep?`${(p.E/1e9).toFixed(3)} GPa`:'—';
  if(ui.creepFactor) ui.creepFactor.textContent=hasCreep?`${p.creep.factor.toFixed(3)}×`:'1.000×';
  if(ui.creepModelNote) ui.creepModelNote.textContent=hasCreep?'Burgers model; calibrated for untreated 0°-raster FDM PLA at 27 °C, 8–12 MPa, 0–1800 s.':'No room-temperature creep law is assigned to this preset in v1.';
  ui.loadLabel.childNodes[0].nodeValue=state.example==='crossed'?'Applied torque ':'Applied force ';
}

let solveTimer=null;
function queueSolve(){
  syncOutputs();
  clearTimeout(solveTimer);
  ui.solverPill.textContent='Solving…'; ui.solverPill.className='solver-pill solving';
  solveTimer=setTimeout(runSolve,45);
}

function runSolve(){
  const token=++state.lastSolveToken, p=params();
  try{
    const model=buildModel(state.example,p);
    const result=solveStatic(model,{steps:6,maxIter:20});
    const modalModel=p.creep?.active ? buildModel(state.example,{...p,E:p.material.E}) : model;
    const mode=firstMode(modalModel);
    if(token!==state.lastSolveToken)return;
    state.model=model; state.result=result; state.mode=mode; state.metrics=modelMetrics(model,result,mode);
    updateMetrics(p); updateValidation(p); updateWarnings(p);
    ui.solverPill.textContent=result.converged?'Converged':'Not converged';
    ui.solverPill.className=`solver-pill ${result.converged?'good':'bad'}`;
    draw(performance.now());
    ensureAnimation();
  }catch(err){
    console.error(err);
    ui.solverPill.textContent='Solver error'; ui.solverPill.className='solver-pill bad';
    ui.warningText.textContent='The current parameter set could not be solved.';
  }
}

function updateMetrics(p){
  const m=state.metrics;
  ui.dispMetric.textContent=formatLength(m.maxDisp);
  ui.stressMetric.textContent=formatStress(m.maxStress);
  ui.freqMetric.textContent=Number.isFinite(m.frequency)?formatFreq(m.frequency):'—';
  if(state.example==='crossed') ui.stiffMetric.textContent=Number.isFinite(m.stiffness)?`${m.stiffness.toFixed(3)} N·m/rad`:'—';
  else ui.stiffMetric.textContent=Number.isFinite(m.stiffness)?`${m.stiffness.toFixed(0)} N/m`:'—';
}

function updateValidation(p){
  if(state.example==='beam'){
    const a=beamAnalytical(p), aModal=beamAnalytical({...p,E:p.material.E}), tipNode=state.model.meta.outputNodes[0];
    const femTip=state.result.q[3*tipNode+1];
    const eDisp=Math.abs((femTip-a.tip)/Math.max(1e-30,a.tip))*100;
    const eFreq=Math.abs((state.mode.frequency-aModal.f1)/aModal.f1)*100;
    ui.validationContent.innerHTML=`
      <div class="check"><span>Tip deflection vs. <code>FL³/3EI</code></span><strong class="${eDisp<0.5?'good-text':'warn-text'}">${eDisp.toFixed(3)}%</strong><small>small-deflection reference: ${formatLength(a.tip)}; FEM: ${formatLength(femTip)}</small></div>
      <div class="check"><span>First mode vs. cantilever closed form</span><strong class="${eFreq<0.5?'good-text':'warn-text'}">${eFreq.toFixed(3)}%</strong><small>reference: ${formatFreq(aModal.f1)}; FEM: ${formatFreq(state.mode.frequency)}</small></div>
      <div class="check"><span>Equilibrium</span><strong class="${state.result.converged?'good-text':'warn-text'}">${state.result.converged?'converged':'check load'}</strong><small>${state.result.iterations} Newton iterations over load steps</small></div>`;
  } else {
    const slender=p.length/p.thickness;
    ui.validationContent.innerHTML=`
      <div class="check"><span>Nonlinear equilibrium</span><strong class="${state.result.converged?'good-text':'warn-text'}">${state.result.converged?'converged':'not converged'}</strong><small>${state.result.iterations} Newton iterations over load steps</small></div>
      <div class="check"><span>Leaf slenderness <code>L/t</code></span><strong class="${slender>15?'good-text':'warn-text'}">${slender.toFixed(1)}</strong><small>Euler–Bernoulli is most appropriate for slender leaves; shear deformation becomes increasingly relevant as L/t falls.</small></div>
      <div class="check"><span>Mesh</span><strong>${p.mesh} elem/leaf</strong><small>Increase mesh density to inspect convergence of displacement, stress and frequency.</small></div>`;
  }
}

function updateWarnings(p){
  const slender=p.length/p.thickness;
  const strainLike=state.metrics.maxStress/p.E;
  const warnings=[];
  if(slender<12) warnings.push('low L/t: shear deformation omitted');
  if(strainLike>0.005) warnings.push('high elastic strain: beam assumptions may be stressed');
  if(p.creep?.active && p.material.creep){
    const sm=state.metrics.maxStress/1e6, [lo,hi]=p.material.creep.stressRangeMPa;
    if(sm<lo || sm>hi) warnings.push(`PLA creep fit calibrated at ${lo}–${hi} MPa; current peak is ${sm.toFixed(1)} MPa`);
  }
  if(!state.result.converged) warnings.push('nonlinear equilibrium not reached');
  ui.warningText.textContent=warnings.join(' · ');
}

function ensureAnimation(){
  if(state.raf) cancelAnimationFrame(state.raf);
  if(ui.animateMode.checked){ state.raf=requestAnimationFrame(frame); }
  else { state.raf=null; draw(performance.now()); }
}
function frame(t){ draw(t); if(ui.animateMode.checked) state.raf=requestAnimationFrame(frame); else state.raf=null; }

function draw(t){
  if(!state.model)return;
  const model=state.model, result=state.result, mode=state.mode, p=params();
  const W=900,H=560,pad=80;
  const allX=model.nodes.map(n=>n.x), allY=model.nodes.map(n=>n.y);
  const xMin=Math.min(...allX),xMax=Math.max(...allX),yMin=Math.min(...allY),yMax=Math.max(...allY);
  const geomW=Math.max(1e-6,xMax-xMin), geomH=Math.max(p.thickness*8,yMax-yMin,p.length*.25);
  const sx=(W-2*pad)/geomW, sy=(H-2*pad)/geomH, sc=Math.min(sx,sy);
  const ox=pad-xMin*sc, oy=H/2+(yMin+yMax)*0.5*sc;
  const map=pt=>({x:ox+pt.x*sc,y:oy-pt.y*sc});
  const qVis=result.q.slice();
  const staticScale=+ui.deformScale.value;
  let modeAmp=0;
  if(ui.animateMode.checked && mode.ok){
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const phase=reduced?1:Math.sin(t*0.001*2*Math.PI*0.65);
    modeAmp=0.065*p.length*phase;
  }
  for(let i=0;i<qVis.length;i+=3){
    qVis[i]=result.q[i]*staticScale + mode.mode[i]*modeAmp;
    qVis[i+1]=result.q[i+1]*staticScale + mode.mode[i+1]*modeAmp;
    qVis[i+2]=result.q[i+2]*staticScale + mode.mode[i+2]*modeAmp;
  }
  const maxStress=Math.max(1,...result.stresses.filter((_,i)=>model.elements[i].kind==='flexure'));
  const items=[];
  items.push(`<defs><pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#182332" stroke-width="1"/></pattern></defs><rect width="900" height="560" fill="url(#grid)"/>`);
  for(const e of model.elements){
    const a=map(model.nodes[e.i]),b=map(model.nodes[e.j]);
    items.push(`<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="#526170" stroke-opacity=".35" stroke-width="2" stroke-dasharray="6 6"/>`);
  }
  model.elements.forEach((e,idx)=>{
    const pts=deformedElementPoints(model,e,qVis,1,14).map(map);
    const d=pts.map((pt,k)=>`${k?'L':'M'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(' ');
    const ratio=e.kind==='stage'?0:Math.min(1,result.stresses[idx]/maxStress);
    const color=e.kind==='stage'?'#a7b3c1':stressColor(ratio);
    const sw=e.kind==='stage'?Math.max(5,e.t*sc*.55):Math.max(2,Math.min(11,e.t*sc));
    items.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round"/>`);
  });
  const fixedNodes=[...new Set([...model.fixed].map(d=>Math.floor(d/3)))];
  for(const n of fixedNodes){ const pt=map(model.nodes[n]); items.push(`<g transform="translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})"><line x1="0" y1="-18" x2="0" y2="18" stroke="#d7e1ea" stroke-width="4"/><path d="M0 -16l-16 -10M0 -8l-16 -10M0 0l-16 -10M0 8l-16 -10M0 16l-16 -10" stroke="#65778a" stroke-width="2"/></g>`); }
  if(state.example==='crossed'){
    const cp=map({x:p.length/2,y:0}); items.push(`<circle cx="${cp.x}" cy="${cp.y}" r="9" fill="#0b1017" stroke="#71859a" stroke-dasharray="3 3"/><text x="${cp.x+13}" y="${cp.y-11}" fill="#8fa0b5" font-size="11">no joint</text>`);
  }
  items.push(loadGraphic(model,qVis,map,p));
  const barMm=niceLength(p.length*1000/4); const barPx=(barMm/1000)*sc;
  items.push(`<g transform="translate(70 505)"><line x1="0" y1="0" x2="${barPx.toFixed(1)}" y2="0" stroke="#d9e4ed" stroke-width="2"/><line x1="0" y1="-5" x2="0" y2="5" stroke="#d9e4ed"/><line x1="${barPx.toFixed(1)}" y1="-5" x2="${barPx.toFixed(1)}" y2="5" stroke="#d9e4ed"/><text x="${(barPx/2).toFixed(1)}" y="20" text-anchor="middle" fill="#8fa0b5" font-size="11">${barMm} mm</text></g>`);
  svg.innerHTML=items.join('');
}

function loadGraphic(model,q,map,p){
  if(state.example==='crossed'){
    const ns=model.meta.outputNodes.map(i=>({x:model.nodes[i].x+q[3*i],y:model.nodes[i].y+q[3*i+1]}));
    const c=map({x:(ns[0].x+ns[1].x)/2,y:(ns[0].y+ns[1].y)/2});
    const sign=Math.sign(p.load)||1;
    return `<g><path d="M${c.x-36},${c.y} A36,36 0 1 ${sign>0?1:0} ${c.x+18},${c.y-31}" fill="none" stroke="#ffcf75" stroke-width="3"/><path d="M${c.x+18},${c.y-31} l${sign>0?-2:10},12 l${sign>0?12:-12},2" fill="none" stroke="#ffcf75" stroke-width="3"/><text x="${c.x+45}" y="${c.y-35}" fill="#ffcf75" font-size="12">M</text></g>`;
  }
  const ids=model.meta.outputNodes;
  let px=0,py=0;
  for(const i of ids){ px+=model.nodes[i].x+q[3*i]; py+=model.nodes[i].y+q[3*i+1]; }
  const pt=map({x:px/ids.length,y:py/ids.length});
  const sign=Math.sign(p.load)||1, y2=pt.y-sign*48;
  return `<g><line x1="${pt.x}" y1="${y2}" x2="${pt.x}" y2="${pt.y}" stroke="#ffcf75" stroke-width="3"/><path d="M${pt.x},${pt.y} l-7,${-sign*12} M${pt.x},${pt.y} l7,${-sign*12}" stroke="#ffcf75" stroke-width="3"/><text x="${pt.x+12}" y="${(y2+pt.y)/2}" fill="#ffcf75" font-size="12">F</text></g>`;
}

function stressColor(r){
  const stops=[[101,200,255],[142,231,176],[255,211,110],[255,117,131]];
  const x=Math.max(0,Math.min(.9999,r))*3, i=Math.floor(x), f=x-i, a=stops[i],b=stops[Math.min(3,i+1)];
  return `rgb(${Math.round(a[0]+(b[0]-a[0])*f)},${Math.round(a[1]+(b[1]-a[1])*f)},${Math.round(a[2]+(b[2]-a[2])*f)})`;
}
function creepSecondsFromSlider(v){ return Math.max(0,Math.min(1800,v)); }
function formatDuration(s){ if(s<60)return `${s.toFixed(0)} s`; return `${(s/60).toFixed(s<600?1:0)} min`; }
function niceLength(mm){ const p=10**Math.floor(Math.log10(Math.max(1e-9,mm))),n=mm/p; return (n<2?1:n<5?2:n<10?5:10)*p; }
function formatLength(m){ const a=Math.abs(m); if(a<1e-6)return `${(m*1e9).toFixed(1)} nm`; if(a<1e-3)return `${(m*1e6).toFixed(2)} µm`; return `${(m*1e3).toFixed(3)} mm`; }
function formatStress(pa){ if(pa<1e6)return `${(pa/1e3).toFixed(1)} kPa`; return `${(pa/1e6).toFixed(1)} MPa`; }
function formatFreq(hz){ return hz>=1000?`${(hz/1000).toFixed(2)} kHz`:`${hz.toFixed(1)} Hz`; }

$$('.example-btn').forEach(btn=>btn.addEventListener('click',()=>{
  state.loadByExample[state.example]=+ui.load.value;
  state.example=btn.dataset.example;
  $$('.example-btn').forEach(b=>b.classList.toggle('active',b===btn));
  configureForExample(); queueSolve();
}));
[ui.length,ui.thickness,ui.width,ui.spacing,ui.mesh,ui.material,ui.load,ui.deformScale,ui.creepTime].forEach(el=>el.addEventListener('input',()=>{
  if(el===ui.load) state.loadByExample[state.example]=+ui.load.value;
  if(el===ui.deformScale && state.model){syncOutputs();draw(performance.now());return;}
  queueSolve();
}));
ui.animateMode.addEventListener('change',ensureAnimation);
ui.creepEnabled?.addEventListener('change',queueSolve);
configureForExample();
runSolve();
