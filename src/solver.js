const TAU = Math.PI * 2;

export function makeMaterial(key) {
  const materials = {
    al7075: { name: 'Al 7075-T6', E: 71.7e9, rho: 2810 },
    steel17: { name: '17-4PH steel', E: 197e9, rho: 7800 },
    ti64: { name: 'Ti-6Al-4V', E: 114e9, rho: 4430 },
    pla: { name: 'PLA (nominal bulk)', E: 3.5e9, rho: 1240 },
  };
  return materials[key] ?? materials.al7075;
}

export function buildModel(kind, p) {
  if (kind === 'crossed') return buildCrossed(p);
  if (kind === 'parallelogram') return buildParallelogram(p);
  return buildBeam(p);
}

function section(p, stage = false) {
  const w = p.width;
  const t = stage ? Math.max(8 * p.thickness, 0.18 * p.spacing) : p.thickness;
  return { A: w * t, I: w * t ** 3 / 12, t };
}

function addPolyline(model, a, b, divisions, props, reuseStart = null, reuseEnd = null) {
  const ids = [];
  for (let k = 0; k <= divisions; k++) {
    if (k === 0 && reuseStart !== null) { ids.push(reuseStart); continue; }
    if (k === divisions && reuseEnd !== null) { ids.push(reuseEnd); continue; }
    const s = k / divisions;
    const id = model.nodes.length;
    model.nodes.push({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
    ids.push(id);
  }
  for (let k = 0; k < divisions; k++) model.elements.push({ i: ids[k], j: ids[k + 1], ...props });
  return ids;
}

function flexProps(p) {
  const s = section(p, false);
  return { E: p.E, rho: p.rho, A: s.A, I: s.I, t: s.t, kind: 'flexure' };
}

function stageProps(p) {
  const s = section(p, true);
  return { E: p.E, rho: p.rho, A: s.A, I: s.I, t: s.t, kind: 'stage' };
}

function blankModel() {
  return { nodes: [], elements: [], fixed: new Set(), loads: [], meta: {} };
}

function fixNode(model, id) {
  model.fixed.add(3 * id); model.fixed.add(3 * id + 1); model.fixed.add(3 * id + 2);
}

function addLoad(model, node, fx = 0, fy = 0, m = 0) {
  model.loads.push({ node, fx, fy, m });
}

function buildBeam(p) {
  const m = blankModel();
  const ids = addPolyline(m, {x:0,y:0}, {x:p.length,y:0}, p.mesh, flexProps(p));
  fixNode(m, ids[0]);
  addLoad(m, ids.at(-1), 0, p.load, 0);
  m.meta = { kind:'beam', outputNodes:[ids.at(-1)], flexureLength:p.length, loadMeasure:p.load };
  return m;
}

function buildCrossed(p) {
  const m = blankModel();
  const y = p.spacing / 2;
  const first = addPolyline(m, {x:0,y:-y}, {x:p.length,y:+y}, p.mesh, flexProps(p));
  const second = addPolyline(m, {x:0,y:+y}, {x:p.length,y:-y}, p.mesh, flexProps(p));
  fixNode(m, first[0]); fixNode(m, second[0]);
  const topRight = first.at(-1), bottomRight = second.at(-1);
  addPolyline(m, m.nodes[bottomRight], m.nodes[topRight], 1, stageProps(p), bottomRight, topRight);
  addLoad(m, topRight, 0, 0, 0.5 * p.load);
  addLoad(m, bottomRight, 0, 0, 0.5 * p.load);
  m.meta = { kind:'crossed', outputNodes:[topRight,bottomRight], flexureLength:p.length, loadMeasure:p.load, crossingUnjoined:true };
  return m;
}

function buildParallelogram(p) {
  const m = blankModel();
  const y = p.spacing / 2;
  const bottom = addPolyline(m, {x:0,y:-y}, {x:p.length,y:-y}, p.mesh, flexProps(p));
  const top = addPolyline(m, {x:0,y:+y}, {x:p.length,y:+y}, p.mesh, flexProps(p));
  fixNode(m, bottom[0]); fixNode(m, top[0]);
  const br = bottom.at(-1), tr = top.at(-1);
  addPolyline(m, m.nodes[br], m.nodes[tr], 1, stageProps(p), br, tr);
  addLoad(m, tr, 0, 0.5 * p.load, 0);
  addLoad(m, br, 0, 0.5 * p.load, 0);
  m.meta = { kind:'parallelogram', outputNodes:[tr,br], flexureLength:p.length, loadMeasure:p.load };
  return m;
}

function elementReference(model, e) {
  const a = model.nodes[e.i], b = model.nodes[e.j];
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return { L, a0: Math.atan2(dy, dx) };
}

function elementState(model, e, q) {
  const a = model.nodes[e.i], b = model.nodes[e.j];
  const ia = 3 * e.i, ib = 3 * e.j;
  const x1 = a.x + q[ia], y1 = a.y + q[ia + 1];
  const x2 = b.x + q[ib], y2 = b.y + q[ib + 1];
  const th1 = q[ia + 2], th2 = q[ib + 2];
  const ref = elementReference(model, e);
  const dx = x2 - x1, dy = y2 - y1;
  const l = Math.max(Math.hypot(dx, dy), ref.L * 1e-9);
  const c = dx / l, s = dy / l;
  const aNow = Math.atan2(dy, dx);
  const delta = wrapAngle(aNow - ref.a0);
  const phi1 = th1 - delta, phi2 = th2 - delta;
  const kax = e.E * e.A / ref.L;
  const kb = e.E * e.I / ref.L;
  const N = kax * (l - ref.L);
  const M1 = kb * (4 * phi1 + 2 * phi2);
  const M2 = kb * (2 * phi1 + 4 * phi2);
  return { ...ref, x1,y1,x2,y2,l,c,s,aNow,delta,phi1,phi2,N,M1,M2 };
}

function elementForceFromLocalState(model, e, qLocal) {
  const a = model.nodes[e.i], b = model.nodes[e.j];
  const dx0 = b.x - a.x, dy0 = b.y - a.y;
  const L = Math.hypot(dx0, dy0);
  const a0 = Math.atan2(dy0, dx0);
  const x1 = a.x + qLocal[0], y1 = a.y + qLocal[1];
  const x2 = b.x + qLocal[3], y2 = b.y + qLocal[4];
  const dx = x2-x1, dy = y2-y1;
  const l = Math.max(Math.hypot(dx,dy), L*1e-9);
  const c=dx/l, s=dy/l;
  const delta=wrapAngle(Math.atan2(dy,dx)-a0);
  const p1=qLocal[2]-delta, p2=qLocal[5]-delta;
  const N=e.E*e.A/L*(l-L);
  const kb=e.E*e.I/L;
  const m1=kb*(4*p1+2*p2), m2=kb*(2*p1+4*p2), ms=m1+m2;
  return [
    -N*c - ms*s/l,
    -N*s + ms*c/l,
    m1,
    +N*c + ms*s/l,
    +N*s - ms*c/l,
    m2,
  ];
}

function localQ(e, q) {
  const ia=3*e.i, ib=3*e.j;
  return [q[ia],q[ia+1],q[ia+2],q[ib],q[ib+1],q[ib+2]];
}

function elementTangent(model, e, q) {
  const qe = localQ(e,q);
  const {L} = elementReference(model,e);
  const K = zeroMatrix(6,6);
  for(let j=0;j<6;j++){
    const h = (j===2 || j===5) ? 2e-6 : Math.max(2e-9, 2e-6*L);
    const qp=qe.slice(), qm=qe.slice(); qp[j]+=h; qm[j]-=h;
    const fp=elementForceFromLocalState(model,e,qp), fm=elementForceFromLocalState(model,e,qm);
    for(let i=0;i<6;i++) K[i][j]=(fp[i]-fm[i])/(2*h);
  }
  for(let i=0;i<6;i++) for(let j=i+1;j<6;j++){
    const v=0.5*(K[i][j]+K[j][i]); K[i][j]=v; K[j][i]=v;
  }
  return K;
}

function totalStrainEnergy(model,q){
  let U=0;
  for(const e of model.elements){
    const s=elementState(model,e,q);
    U += 0.5*(e.E*e.A/s.L)*(s.l-s.L)**2;
    const kb=e.E*e.I/s.L;
    U += 0.5*kb*(4*s.phi1**2 + 4*s.phi1*s.phi2 + 4*s.phi2**2);
  }
  return U;
}

function totalPotential(model,q,F){
  let p=totalStrainEnergy(model,q);
  for(let i=0;i<q.length;i++) p -= F[i]*q[i];
  return p;
}

function assembleInternalAndTangent(model,q,needTangent=true){
  const n=model.nodes.length*3;
  const f=new Float64Array(n);
  const K=needTangent ? zeroMatrix(n,n) : null;
  for(const e of model.elements){
    const qe=localQ(e,q), fe=elementForceFromLocalState(model,e,qe);
    const map=[3*e.i,3*e.i+1,3*e.i+2,3*e.j,3*e.j+1,3*e.j+2];
    for(let a=0;a<6;a++) f[map[a]]+=fe[a];
    if(needTangent){
      const ke=elementTangent(model,e,q);
      for(let a=0;a<6;a++) for(let b=0;b<6;b++) K[map[a]][map[b]]+=ke[a][b];
    }
  }
  return {f,K};
}

function externalVector(model,scale=1){
  const F=new Float64Array(model.nodes.length*3);
  for(const l of model.loads){
    F[3*l.node]+=scale*l.fx; F[3*l.node+1]+=scale*l.fy; F[3*l.node+2]+=scale*l.m;
  }
  return F;
}

function freeDofs(model){
  const n=model.nodes.length*3, free=[];
  for(let i=0;i<n;i++) if(!model.fixed.has(i)) free.push(i);
  return free;
}

export function solveStatic(model, options={}){
  const n=model.nodes.length*3, q=new Float64Array(n), free=freeDofs(model);
  const steps=options.steps ?? 6, maxIter=options.maxIter ?? 22;
  let converged=true, totalIterations=0, residualNorm=0;
  for(let step=1;step<=steps;step++){
    const factor=step/steps, F=externalVector(model,factor);
    let stepConverged=false;
    for(let iter=0;iter<maxIter;iter++){
      totalIterations++;
      const {f,K}=assembleInternalAndTangent(model,q,true);
      const r=free.map(d=>F[d]-f[d]);
      residualNorm=norm(r);
      const forceScale=Math.max(1, norm(free.map(d=>F[d])));
      if(residualNorm/forceScale < 2e-7){ stepConverged=true; break; }
      const Kr=subMatrix(K,free), dq=solveLinear(Kr,r);
      if(!dq){ converged=false; break; }
      const phi0=totalPotential(model,q,F);
      let alpha=1, accepted=false;
      while(alpha>=1/128){
        const trial=q.slice();
        for(let k=0;k<free.length;k++) trial[free[k]] += alpha*dq[k];
        const phi=totalPotential(model,trial,F);
        if(Number.isFinite(phi) && phi <= phi0 + 1e-9*Math.max(1,Math.abs(phi0))){
          q.set(trial); accepted=true; break;
        }
        alpha*=0.5;
      }
      if(!accepted){
        for(let k=0;k<free.length;k++) q[free[k]] += 0.05*dq[k];
      }
    }
    if(!stepConverged){ converged=false; break; }
  }
  const {f:internal}=assembleInternalAndTangent(model,q,false);
  return { q, converged, iterations:totalIterations, residualNorm, internal, stresses:elementStresses(model,q) };
}

export function assembleLinearKM(model){
  const n=model.nodes.length*3, K=zeroMatrix(n,n), M=zeroMatrix(n,n);
  for(const e of model.elements){
    const ref=elementReference(model,e), L=ref.L, c=Math.cos(ref.a0), s=Math.sin(ref.a0);
    const EA=e.E*e.A, EI=e.E*e.I;
    const k=zeroMatrix(6,6);
    const a=EA/L, b=12*EI/L**3, cc=6*EI/L**2, d=4*EI/L, ee=2*EI/L;
    k[0][0]=a; k[0][3]=-a; k[3][0]=-a; k[3][3]=a;
    k[1][1]=b; k[1][2]=cc; k[1][4]=-b; k[1][5]=cc;
    k[2][1]=cc; k[2][2]=d; k[2][4]=-cc; k[2][5]=ee;
    k[4][1]=-b; k[4][2]=-cc; k[4][4]=b; k[4][5]=-cc;
    k[5][1]=cc; k[5][2]=ee; k[5][4]=-cc; k[5][5]=d;
    const ml=e.rho*e.A*L/420;
    const mm = [
      [140,0,0,70,0,0],
      [0,156,22*L,0,54,-13*L],
      [0,22*L,4*L*L,0,13*L,-3*L*L],
      [70,0,0,140,0,0],
      [0,54,13*L,0,156,-22*L],
      [0,-13*L,-3*L*L,0,-22*L,4*L*L],
    ].map(row=>row.map(v=>v*ml));
    const T=[
      [c,s,0,0,0,0],[-s,c,0,0,0,0],[0,0,1,0,0,0],
      [0,0,0,c,s,0],[0,0,0,-s,c,0],[0,0,0,0,0,1],
    ];
    const kg=matMul(transpose(T),matMul(k,T));
    const mg=matMul(transpose(T),matMul(mm,T));
    const map=[3*e.i,3*e.i+1,3*e.i+2,3*e.j,3*e.j+1,3*e.j+2];
    for(let i=0;i<6;i++) for(let j=0;j<6;j++) { K[map[i]][map[j]]+=kg[i][j]; M[map[i]][map[j]]+=mg[i][j]; }
  }
  return {K,M};
}

export function firstMode(model){
  const {K,M}=assembleLinearKM(model), free=freeDofs(model);
  const Kr=subMatrix(K,free), Mr=subMatrix(M,free);
  const L=cholesky(Kr);
  if(!L) return {frequency:NaN, mode:new Float64Array(model.nodes.length*3), ok:false};
  let x=new Float64Array(free.length);
  for(let i=0;i<x.length;i++) x[i]=Math.sin((i+1)*1.618)+0.17*Math.cos((i+1)*0.77);
  normalizeM(x,Mr);
  for(let it=0;it<45;it++){
    const rhs=matVec(Mr,x), y=choleskySolve(L,rhs);
    normalizeM(y,Mr);
    let diff=0; for(let i=0;i<x.length;i++) diff+=(y[i]-x[i])**2;
    x=y;
    if(diff<1e-18) break;
  }
  const Kx=matVec(Kr,x), Mx=matVec(Mr,x);
  const lambda=dot(x,Kx)/Math.max(1e-30,dot(x,Mx));
  const full=new Float64Array(model.nodes.length*3);
  for(let i=0;i<free.length;i++) full[free[i]]=x[i];
  const maxT=maxTranslation(full);
  if(maxT>0) for(let i=0;i<full.length;i++) full[i]/=maxT;
  return {frequency:Math.sqrt(Math.max(0,lambda))/TAU, mode:full, ok:Number.isFinite(lambda)&&lambda>0};
}

function normalizeM(x,M){
  const mx=matVec(M,x), n=Math.sqrt(Math.max(1e-30,dot(x,mx)));
  for(let i=0;i<x.length;i++) x[i]/=n;
}

export function elementStresses(model,q){
  return model.elements.map(e=>{
    const st=elementState(model,e,q);
    const c=e.t/2;
    const axial=st.N/e.A;
    const s1a=axial+st.M1*c/e.I, s1b=axial-st.M1*c/e.I;
    const s2a=axial+st.M2*c/e.I, s2b=axial-st.M2*c/e.I;
    return Math.max(Math.abs(s1a),Math.abs(s1b),Math.abs(s2a),Math.abs(s2b));
  });
}

export function modelMetrics(model, result, mode){
  const q=result.q;
  let maxDisp=0;
  for(let i=0;i<model.nodes.length;i++) maxDisp=Math.max(maxDisp,Math.hypot(q[3*i],q[3*i+1]));
  const maxStress=Math.max(0,...result.stresses.filter((_,i)=>model.elements[i].kind==='flexure'));
  let outputDisp=0;
  for(const node of model.meta.outputNodes) outputDisp += Math.hypot(q[3*node],q[3*node+1]);
  outputDisp/=model.meta.outputNodes.length;
  let stiffness=NaN;
  if(model.meta.kind==='beam' || model.meta.kind==='parallelogram') stiffness=Math.abs(model.meta.loadMeasure)/Math.max(1e-15,outputDisp);
  if(model.meta.kind==='crossed'){
    let rot=0; for(const node of model.meta.outputNodes) rot += q[3*node+2]; rot/=model.meta.outputNodes.length;
    stiffness=Math.abs(model.meta.loadMeasure)/Math.max(1e-15,Math.abs(rot));
  }
  return {maxDisp,maxStress,frequency:mode.frequency,stiffness,outputDisp};
}

export function beamAnalytical(p){
  const I=p.width*p.thickness**3/12, A=p.width*p.thickness;
  const tip=p.load*p.length**3/(3*p.E*I);
  const beta1=1.875104068711961;
  const f1=beta1**2/(2*Math.PI*p.length**2)*Math.sqrt(p.E*I/(p.rho*A));
  return {tip,f1};
}

export function deformedElementPoints(model,e,q,scale=1,samples=12){
  const a=model.nodes[e.i], b=model.nodes[e.j];
  const qe=localQ(e,q).map(v=>v*scale);
  const x1=a.x+qe[0], y1=a.y+qe[1], x2=b.x+qe[3], y2=b.y+qe[4];
  const dx=x2-x1, dy=y2-y1, l=Math.max(Math.hypot(dx,dy),1e-12), alpha=Math.atan2(dy,dx);
  const {a0}=elementReference(model,e);
  const delta=wrapAngle(alpha-a0);
  const p1=qe[2]-delta, p2=qe[5]-delta;
  const c=Math.cos(alpha), s=Math.sin(alpha), pts=[];
  for(let k=0;k<=samples;k++){
    const z=k/samples;
    const N2=l*(z-2*z*z+z*z*z), N4=l*(-z*z+z*z*z);
    const v=N2*p1+N4*p2, x=z*l;
    pts.push({x:x1+c*x-s*v,y:y1+s*x+c*v});
  }
  return pts;
}

function wrapAngle(a){ while(a>Math.PI)a-=TAU; while(a<-Math.PI)a+=TAU; return a; }
function zeroMatrix(r,c){ return Array.from({length:r},()=>new Float64Array(c)); }
function transpose(A){ const r=A.length,c=A[0].length,B=zeroMatrix(c,r); for(let i=0;i<r;i++)for(let j=0;j<c;j++)B[j][i]=A[i][j]; return B; }
function matMul(A,B){ const r=A.length,k=A[0].length,c=B[0].length,C=zeroMatrix(r,c); for(let i=0;i<r;i++)for(let n=0;n<k;n++){const a=A[i][n]; if(a===0)continue; for(let j=0;j<c;j++)C[i][j]+=a*B[n][j];} return C; }
function matVec(A,x){ const y=new Float64Array(A.length); for(let i=0;i<A.length;i++){let s=0;for(let j=0;j<x.length;j++)s+=A[i][j]*x[j];y[i]=s;} return y; }
function dot(a,b){ let s=0; for(let i=0;i<a.length;i++)s+=a[i]*b[i]; return s; }
function norm(a){ return Math.sqrt(dot(a,a)); }
function subMatrix(A,idx){ const B=zeroMatrix(idx.length,idx.length); for(let i=0;i<idx.length;i++)for(let j=0;j<idx.length;j++)B[i][j]=A[idx[i]][idx[j]]; return B; }
function maxTranslation(q){let m=0;for(let i=0;i<q.length/3;i++)m=Math.max(m,Math.hypot(q[3*i],q[3*i+1]));return m;}

function solveLinear(A,b){
  const n=b.length, M=A.map((r,i)=>{const x=Array.from(r);x.push(b[i]);return x;});
  for(let k=0;k<n;k++){
    let p=k,pm=Math.abs(M[k][k]); for(let i=k+1;i<n;i++){const v=Math.abs(M[i][k]);if(v>pm){pm=v;p=i;}}
    if(!Number.isFinite(pm)||pm<1e-18)return null;
    if(p!==k){const t=M[p];M[p]=M[k];M[k]=t;}
    const piv=M[k][k];
    for(let i=k+1;i<n;i++){
      const f=M[i][k]/piv; if(f===0)continue; M[i][k]=0;
      for(let j=k+1;j<=n;j++)M[i][j]-=f*M[k][j];
    }
  }
  const x=new Float64Array(n);
  for(let i=n-1;i>=0;i--){let s=M[i][n];for(let j=i+1;j<n;j++)s-=M[i][j]*x[j];x[i]=s/M[i][i];}
  return x;
}

function cholesky(A){
  const n=A.length,L=zeroMatrix(n,n);
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let s=A[i][j]; for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];
    if(i===j){ if(!(s>1e-16)&&!(s>-1e-9*Math.abs(A[i][i])))return null; L[i][j]=Math.sqrt(Math.max(s,1e-16)); }
    else L[i][j]=s/L[j][j];
  }
  return L;
}
function choleskySolve(L,b){
  const n=b.length,y=new Float64Array(n),x=new Float64Array(n);
  for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i][k]*y[k];y[i]=s/L[i][i];}
  for(let i=n-1;i>=0;i--){let s=y[i];for(let k=i+1;k<n;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i];}
  return x;
}
