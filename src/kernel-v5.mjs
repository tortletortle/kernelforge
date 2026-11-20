import { KernelV3 } from './kernel-v3.mjs';
import { Observer, project, controller, workload4 } from './kernel-v4.mjs';
const fixed = {"horizon":48,"interval":48,"dwell":0,"margin":0.08,"responseWeight":4,"turnaround":true,"survival":false,"wake":false,"arrival":false};
const configs = [{"name":"ROBUST","ensemble":true,"guard":true,"margin":0.08,"floor":0,"dwell":48,"ageLimit":48},{"name":"SINGLE","ensemble":false,"guard":true,"margin":0.08,"floor":0,"dwell":48,"ageLimit":48},{"name":"NO_GUARD","ensemble":true,"guard":false,"margin":0.08,"floor":0,"dwell":48,"ageLimit":48},{"name":"NO_WORST","ensemble":true,"guard":true,"margin":0.08,"floor":-Infinity,"dwell":48,"ageLimit":48}];

function avg(xs){return xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length);}

function candidates(o,k,config){
 const scenes=config.ensemble?[
  {scale:.6,wake:false,arrival:false},{scale:1,wake:false,arrival:false},
  {scale:1.6,wake:false,arrival:false},{scale:1,wake:true,arrival:true}
 ]:[{scale:1,wake:false,arrival:false}];
 return scenes.map(sc=>{
  const s=o.state(k,{...fixed,wake:sc.wake,arrival:sc.arrival});
  const scale=j=>{if(j)j.left=Math.max(1,Math.round(j.left*sc.scale));};
  s.ready.forEach(scale);scale(s.running);s.incoming.forEach(x=>scale(x.job));
  return Object.fromEntries(["MLFQ","RR","FCFS"].map(p=>[p,project(s,p,fixed)]));
 });
}

function riskDriver(config, audit=false){
 const o=new Observer(),trace=[];let last=-Infinity,forced=0,veto=0;
 const run=k=>{
  o.tick(k);
  if(k.pending||k.locked||k.migration)return;
  // React at a safe boundary to actual first-service age, not guessed future.
  const fresh=k.jobs.filter(j=>j.first===null&&(j.state==="READY"||j.state==="RUNNING"));
  const age=Math.max(0,...fresh.map(j=>k.time-j.arrival));
  if(config.guard&&k.policy!=="MLFQ"&&age>=config.ageLimit){
   const old=k.policy;if(k.switchPolicy("MLFQ")){last=k.time;forced++;trace.push({time:k.time,old,next:"MLFQ",reason:"latency_guard",age});}return;
  }
  if(k.time%48||k.ready.length<2||k.time-last<config.dwell)return;
  const scenes=candidates(o,k,config),old=k.policy;
  const ranked=["MLFQ","RR","FCFS"].filter(p=>p!==old).map(p=>{
   const gains=scenes.map(s=>(s[old]-s[p])/Math.max(1,s[old]));
   return {p,gains,score:avg(gains),worst:Math.min(...gains)};
  }).sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  if(best.score<=config.margin)return;
  if(best.worst<config.floor||(config.guard&&best.p==="FCFS"&&fresh.length>0)){veto++;return;}
  if(audit){
   // Offline counterfactual only; never passed to decision logic.
   const truth=counterfactual(k,best.p);
   trace.push({time:k.time,old,next:best.p,reason:"forecast",gains:best.gains,actualGain:truth,age});
  }else trace.push({time:k.time,old,next:best.p,reason:"forecast",gains:best.gains,age});
  if(!k.switchPolicy(best.p))throw Error("Safe switch rejected");
  last=k.time;
 };
 return {run,trace,stats:()=>({forced,veto})};
}

function counterfactual(k,next){
 const loss=p=>{
  const q=KernelV3.restore(k.snapshot());if(!q.switchPolicy(p))throw Error("Counterfactual boundary");
  let total=0;
  for(let t=0;t<48&&!q.done;t++){
   q.step();
   // Exact future information is used ONLY here, after ranking, for a paired offline audit.
   for(const j of q.jobs){if(j.state==="NEW"||j.state==="DONE")continue;total+=1+(j.first===null?4:0);}
  }
  return total;
 };
 const base=loss(k.policy);return (base-loss(next))/Math.max(1,base);
}

function workload5(seed,family,n=24){
 if(family!=="shock"&&family!=="heavy")return workload4(seed,family,n);
 let s=seed>>>0;const r=n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n);};
 return Array.from({length:n},(_,i)=>({id:"p"+i,arrival:family==="shock"?(i<8?r(20):100+r(10)):r(250),bursts:family==="shock"&&i>=8?[1+r(4),3+r(12),1+r(4)]:[i%7===0?140+r(90):5+r(25)]}));
}

function evaluate5(){
 const rows=[];
 const families=["cpu","io","mixed","phase","reverse","sparse","shock","heavy"];
 for(const family of families)for(const cost of [0,1,3])for(let seed=501;seed<=508;seed++){
  const spec=workload5(seed,family),results={},stats={},audits={};
  for(const name of ["FCFS","RR","MLFQ","V4"]){
   const k=new KernelV3(spec,name==="V4"?"MLFQ":name,cost,2);
   results[name]=k.run(name==="V4"?controller(fixed).run:null);
  }
  for(const c of configs){
   const k=new KernelV3(spec,"MLFQ",cost,2),d=riskDriver(c,true);
   results[c.name]=k.run(d.run);stats[c.name]=d.stats();audits[c.name]=d.trace.filter(t=>t.reason==="forecast");
  }
  const rr=results.RR,score=m=>(m.meanResponse/Math.max(1,rr.meanResponse)+m.meanTurnaround/Math.max(1,rr.meanTurnaround))/2;
  rows.push({family,cost,seed,results,scores:Object.fromEntries(Object.entries(results).map(([p,m])=>[p,score(m)])),stats,audits});
 }
 const summary={};
 for(const p of Object.keys(rows[0].results)){
  const delta=rows.map(r=>r.scores[p]/r.scores.MLFQ-1).sort((a,b)=>a-b);
  const aud=rows.flatMap(r=>r.audits[p]||[]);
  summary[p]={score:avg(rows.map(r=>r.scores[p])),wins:rows.filter(r=>r.scores[p]<Math.min(r.scores.FCFS,r.scores.RR,r.scores.MLFQ)-1e-9).length,
    worse10:delta.filter(x=>x>.1+1e-9).length,p95Regret:delta[Math.ceil(.95*delta.length)-1],worstRegret:delta.at(-1),
    response:avg(rows.map(r=>r.results[p].meanResponse)),p99Response:avg(rows.map(r=>r.results[p].p99Response)),
    turnaround:avg(rows.map(r=>r.results[p].meanTurnaround)),changes:avg(rows.map(r=>r.results[p].changes)),
    forced:rows.reduce((s,r)=>s+(r.stats[p]?.forced||0),0),veto:rows.reduce((s,r)=>s+(r.stats[p]?.veto||0),0),
    auditN:aud.length,auditNegative:aud.filter(t=>t.actualGain<0).length,auditPositive:aud.filter(t=>t.actualGain>0).length};
 }
 const byFamily=Object.fromEntries(families.map(f=>[f,Object.fromEntries(["MLFQ","V4","ROBUST"].map(p=>[p,avg(rows.filter(r=>r.family===f).map(r=>r.scores[p]))]))]));
 // V4 and V5 comparison at identical paired seeds, independent of prior versions.
 const fixtures=[];
 const j=[{id:"a",arrival:0,bursts:[100]},{id:"b",arrival:0,bursts:[2]}];
 const k=new KernelV3(j,"FCFS",0,2),d=riskDriver(configs[0]);for(let i=0;i<49;i++){d.run(k);k.step();}
 if(d.stats().forced!==1||k.policy!=="MLFQ")throw Error("latency guard");
 fixtures.push("safe-boundary emergency return");
 const q=new KernelV3(j,"MLFQ",1,2);for(let i=0;i<5;i++)q.step();if(!q.locked&&!q.pending&&!q.migration){const before=q.snapshot();counterfactual(q,"RR");if(q.snapshot()!==before)throw Error("audit mutated live kernel");}
 fixtures.push("counterfactual isolation");
 return {groups:rows.length,runs:rows.length*8,summary,byFamily,fixtures,rows};
}
export {riskDriver,counterfactual,evaluate5};
