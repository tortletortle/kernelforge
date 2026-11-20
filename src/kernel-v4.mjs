import { KernelV3, predictive } from './kernel-v3.mjs';

function mean(a,f=x=>x){return a.reduce((s,x)=>s+f(x),0)/Math.max(1,a.length);}

function residual(samples,age,fallback){
 const alive=samples.filter(x=>x>age);
 return Math.max(1,Math.round(alive.length?mean(alive,x=>x-age):Math.max(1,fallback-age/2)));
}

class Observer {
 constructor(){this.blocked=new Map();this.arrivals=[];this.seen=new Set();this.woke=[];this.lastChange=-Infinity;}
 tick(k){
  for(const j of k.jobs){
   if(j.state==="NEW")continue;
   if(!this.seen.has(j.id)){this.seen.add(j.id);this.arrivals.push(j.arrival);}
   if(j.state==="BLOCKED"&&!this.blocked.has(j.id))this.blocked.set(j.id,k.time);
   if(j.state!=="BLOCKED"&&this.blocked.has(j.id)){this.woke.push(Math.max(1,k.time-this.blocked.get(j.id)-1));this.blocked.delete(j.id);}
  }
 }
 state(k,config){
  const cpu=[];
  for(const j of k.jobs){if(j.state==="NEW")continue;for(let i=0;i<(j.state==="DONE"?j.index+2:j.index);i+=2)cpu.push(j.bursts[i]);}
  const prior=cpu.length?mean(cpu):12;
  const map=j=>{
   const past=j.bursts.slice(0,j.index).filter((_,i)=>i%2===0),age=j.executed-past.reduce((a,b)=>a+b,0);
   const avg=past.length?mean(past):prior,estimate=config.survival?residual(past.length>=2?past:cpu,age,avg):Math.max(1,Math.round(age<avg?avg-age:avg/2));
   return {id:j.id,left:estimate,level:j.level,used:j.used,fresh:j.first===null};
  };
  const incoming=[];
  if(config.wake)for(const j of k.jobs.filter(j=>j.state==="BLOCKED")){
   const age=Math.max(0,k.time-(this.blocked.get(j.id)??k.time));
   incoming.push({t:residual(this.woke,age,18),job:{...map(j),level:0,used:0}});
  }
  if(config.arrival){
   const recent=this.arrivals.filter(t=>t>=k.time-24).length, earlier=this.arrivals.filter(t=>t>=k.time-48&&t<k.time-24).length;
   const rate=(recent*.75+earlier*.25)/24;
   if(rate>0)for(let n=1;n<=Math.min(24,Math.floor(rate*config.horizon));n++)incoming.push({t:Math.ceil(n/rate),job:{id:"synthetic:"+n,left:Math.max(1,Math.round(prior)),level:0,used:0,fresh:true}});
  }
  return {ready:k.ready.map(id=>map(k.byId.get(id))),running:k.running?map(k.byId.get(k.running)):null,last:k.last,policy:k.policy,time:k.time,cost:k.cost,migrationCost:k.migrationCost,incoming};
 }
}

function project(s,policy,c){
 const q=s.ready.map(j=>({...j})),incoming=s.incoming.map(x=>({t:x.t,job:{...x.job}}));
 let run=s.running?{...s.running}:null,last=s.last,pending=0,lock=false,loss=0;
 const migration=policy===s.policy?0:s.migrationCost;
 if(policy!==s.policy){if(run)q.unshift(run);run=null;for(const j of q){j.level=0;j.used=0;}}
 const weighted=j=>1+(j.fresh?c.responseWeight:0);
 for(let t=0;t<c.horizon;t++){
  for(const x of incoming)if(x.t===t)q.push(x.job);
  if(t<migration){loss+=q.reduce((a,j)=>a+weighted(j),0);continue;}
  if(!pending&&!lock){
   if(policy==="MLFQ"&&s.time+t>0&&(s.time+t)%32===0){for(const j of q){j.level=0;j.used=0;}if(run){run.level=0;run.used=0;q.push(run);run=null;}}
   if(policy==="MLFQ"&&run&&q.some(j=>j.level<run.level)){q.unshift(run);run=null;}
   if(!run&&q.length){const idx=policy==="MLFQ"?q.reduce((a,j,i)=>j.level<q[a].level?i:a,0):0;run=q.splice(idx,1)[0];if(last!==null&&last!==run.id){pending=s.cost;lock=pending>0;}}
  }
  loss+=q.reduce((a,j)=>a+weighted(j),0);
  if(pending){loss+=weighted(run);pending--;continue;}
  if(!run){last=null;continue;}
  if(c.turnaround)loss+=1;
  lock=false;last=run.id;run.fresh=false;run.left--;run.used++;
  if(!run.left)run=null;
  else if(run.used>=(policy==="FCFS"?Infinity:policy==="RR"?3:[2,4,8][run.level])){if(policy==="MLFQ")run.level=Math.min(2,run.level+1);run.used=0;q.push(run);run=null;}
 }
 return loss;
}

function controller(config){
 const o=new Observer(),trace=[];
 const run=k=>{
  o.tick(k);
  if(k.time%config.interval||k.pending||k.locked||k.migration||!k.ready.length||k.time-o.lastChange<config.dwell)return;
  const s=o.state(k,config),values=Object.fromEntries(["FCFS","RR","MLFQ"].map(p=>[p,project(s,p,config)]));
  const base=values[k.policy],best=Object.keys(values).reduce((a,p)=>values[p]<values[a]?p:a,k.policy);
  const old=k.policy,change=best!==old&&base-values[best]>Math.max(3,base*config.margin);
  if(change&&k.switchPolicy(best))o.lastChange=k.time;
  trace.push({t:k.time,old,best,values,changed:old!==k.policy,ready:s.ready.length,predictedArrivals:s.incoming.length});
 };
 return {run,trace};
}

function workload4(seed,family,n=24){
 let s=seed>>>0;const r=n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n);};
 return Array.from({length:n},(_,i)=>{
  const io=family==="io"||(family==="mixed"&&r(2)===0)||(family==="phase"&&i>=n/2)||(family==="reverse"&&i<n/2);
  const phased=family==="phase"||family==="reverse";
  const arrival=phased?(i<n/2?r(35):140+r(50)):family==="sparse"?r(750):r(140);
  return {id:"p"+i,arrival,bursts:io?[1+r(5),8+r(40),1+r(5),8+r(40),1+r(5)]:[10+r(55)]};
 });
}
const grid = [
  {
    "horizon": 48,
    "interval": 48,
    "dwell": 0,
    "margin": 0.08,
    "responseWeight": 1,
    "turnaround": false,
    "survival": false,
    "wake": false,
    "arrival": false,
    "name": "reference"
  },
  {
    "horizon": 48,
    "interval": 48,
    "dwell": 0,
    "margin": 0.08,
    "responseWeight": 4,
    "turnaround": true,
    "survival": false,
    "wake": false,
    "arrival": false,
    "name": "aligned"
  },
  {
    "horizon": 48,
    "interval": 48,
    "dwell": 0,
    "margin": 0.08,
    "responseWeight": 4,
    "turnaround": true,
    "survival": true,
    "wake": false,
    "arrival": false,
    "name": "survival"
  },
  {
    "horizon": 48,
    "interval": 48,
    "dwell": 0,
    "margin": 0.08,
    "responseWeight": 4,
    "turnaround": true,
    "survival": true,
    "wake": true,
    "arrival": false,
    "name": "wake"
  },
  {
    "horizon": 48,
    "interval": 48,
    "dwell": 0,
    "margin": 0.08,
    "responseWeight": 4,
    "turnaround": true,
    "survival": true,
    "wake": true,
    "arrival": true,
    "name": "arrival"
  },
  {
    "horizon": 48,
    "interval": 24,
    "dwell": 48,
    "margin": 0.08,
    "responseWeight": 4,
    "turnaround": true,
    "survival": true,
    "wake": true,
    "arrival": true,
    "name": "responsive"
  },
  {
    "horizon": 48,
    "interval": 24,
    "dwell": 72,
    "margin": 0.2,
    "responseWeight": 6,
    "turnaround": true,
    "survival": true,
    "wake": true,
    "arrival": true,
    "name": "conservative"
  }
];

function runGroup(seed,family,cost,configs){
 const spec=workload4(seed,family), results={};
 for(const p of ["FCFS","RR","MLFQ","V3"]){const k=new KernelV3(spec,p==="V3"?"RR":p,cost,2);results[p]=k.run(p==="V3"?predictive:null);}
 for(const c of configs){const k=new KernelV3(spec,"MLFQ",cost,2),driver=controller(c);results[c.name]=k.run(driver.run);}
 const rr=results.RR,scores=Object.fromEntries(Object.entries(results).map(([p,m])=>[p,(m.meanResponse/Math.max(1,rr.meanResponse)+m.meanTurnaround/Math.max(1,rr.meanTurnaround))/2]));
 return {seed,family,cost,results,scores,best:Math.min(scores.FCFS,scores.RR,scores.MLFQ)};
}

function summarize(rows,names){return Object.fromEntries(names.map(p=>[p,{score:mean(rows,r=>r.scores[p]),wins:rows.filter(r=>r.scores[p]<r.best-1e-9).length,changes:mean(rows,r=>r.results[p].changes),response:mean(rows,r=>r.results[p].meanResponse),turnaround:mean(rows,r=>r.results[p].meanTurnaround)}]));}

function verifyV4(){
 const training=[],test=[];
 // Predefined split; only training selects configuration.
 for(const family of ["cpu","io","mixed","phase","sparse"])for(const cost of [0,1,3])for(let seed=201;seed<=204;seed++)training.push(runGroup(seed,family,cost,grid));
 const train=summarize(training,grid.map(c=>c.name));
 const selected=grid.reduce((a,c)=>train[c.name].score<train[a.name].score?c:a,grid[0]);
 const config={...selected,name:"V4"};
 const variants=[config,{...config,name:"NO_WAKE",wake:false},{...config,name:"NO_ARRIVAL",arrival:false},{...config,name:"NO_SURVIVAL",survival:false},{...config,name:"V4_REF",...grid[0],name:"V4_REF"}];
 for(const family of ["cpu","io","mixed","phase","sparse","reverse"])for(const cost of [0,1,3])for(let seed=301;seed<=308;seed++)test.push(runGroup(seed,family,cost,variants));
 const names=["FCFS","RR","MLFQ","V3",...variants.map(c=>c.name)],summary=summarize(test,names);
 const phase=Object.fromEntries(["phase","reverse"].map(f=>[f,summarize(test.filter(r=>r.family===f),["V3","V4","MLFQ","V4_REF"])]));
 // Cluster resampling by seed (all scenarios for one seed kept together); descriptive percentile interval, 8 clusters.
 const clusters=[...new Set(test.map(r=>r.seed))].map(seed=>mean(test.filter(r=>r.seed===seed),r=>r.scores.V4-r.scores.MLFQ));
 let s=8128;const diffs=[];for(let b=0;b<4000;b++){let total=0;for(let i=0;i<clusters.length;i++){s=(Math.imul(s,1664525)+1013904223)>>>0;total+=clusters[Math.floor(s/4294967296*clusters.length)];}diffs.push(total/clusters.length);}
 diffs.sort((a,b)=>a-b);
 const ci=[diffs[99],diffs[3899]];
 // Causal-observation fixture: same visible history, different undisclosed future.
 const a=new KernelV3([{id:"a",arrival:0,bursts:[10,8,1]},{id:"b",arrival:0,bursts:[9]},{id:"c",arrival:50,bursts:[5]}],"MLFQ"),b=new KernelV3([{id:"a",arrival:0,bursts:[90,80,99]},{id:"b",arrival:0,bursts:[99]},{id:"c",arrival:999,bursts:[99]}],"MLFQ");
 const oa=new Observer(),ob=new Observer();a.step();b.step();oa.tick(a);ob.tick(b);if(JSON.stringify(oa.state(a,config))!==JSON.stringify(ob.state(b,config)))throw Error("Future leakage fixture");
 return {trainingGroups:training.length,testGroups:test.length,trainingRuns:training.length*(4+grid.length),testRuns:test.length*(4+variants.length),selected,train,summary,phase,clusterCI:ci,meanDifference:mean(clusters),fixtures:1,rows:test};
}
export {Observer,project,controller,workload4,verifyV4};
