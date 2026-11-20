// KernelForge V0.3 — committed dispatch, migration overhead, causal predictive benchmark.
class KernelV3 {
  constructor(spec, policy="RR", cost=0, migrationCost=2){
    if(!Number.isSafeInteger(migrationCost)||migrationCost<0)throw Error("Invalid migration cost");
    if(!["FCFS","RR","MLFQ"].includes(policy)||!Number.isSafeInteger(cost)||cost<0)throw Error("Invalid configuration");
    if(!Array.isArray(spec)||new Set(spec.map(x=>x.id)).size!==spec.length)throw Error("Duplicate IDs");
    this.migrationCost=migrationCost;this.migration=0;this.migrationTicks=0;this.migrations=0;this.locked=false;
    this.spec=JSON.parse(JSON.stringify(spec)); this.policy=policy;this.cost=cost;this.time=0;this.busy=0;this.idle=0;this.overhead=0;this.switches=0;this.last=null;this.pending=0;this.running=null;this.ready=[];this.events=[];
    this.jobs=this.spec.map(j=>{
      if(typeof j.id!=="string"||!Number.isSafeInteger(j.arrival)||j.arrival<0||!Array.isArray(j.bursts)||j.bursts.length%2!==1||!j.bursts.every(x=>Number.isSafeInteger(x)&&x>0))throw Error("Invalid job");
      return {id:j.id,arrival:j.arrival,bursts:j.bursts,index:0,left:j.bursts[0],state:"NEW",level:0,used:0,executed:0,wait:0,first:null,finish:null,wake:null};
    });this.index();
  }
  index(){this.byId=new Map(this.jobs.map(j=>[j.id,j]));}
  log(type,details={}){this.events.push({time:this.time,type,...details});}
  enqueue(j,front=false){j.state="READY";if(front)this.ready.unshift(j.id);else this.ready.push(j.id);}
  pick(){return this.policy==="MLFQ"?this.ready.reduce((a,id,i)=>this.byId.get(id).level<this.byId.get(this.ready[a]).level?i:a,0):0;}
  get done(){return this.jobs.every(j=>j.state==="DONE");}
  switchPolicy(next){
    if(!["FCFS","RR","MLFQ"].includes(next))throw Error("Unknown policy");
    if(this.pending!==0||this.locked||this.migration!==0)return false;
    if(next===this.policy)return true;
    if(this.running!==null){this.enqueue(this.byId.get(this.running),true);this.running=null;}
    const old=this.policy;this.policy=next;for(const j of this.jobs){j.level=0;j.used=0;}
    this.migrations++;this.migration=this.migrationCost;this.log("POLICY",{old,next,cost:this.migrationCost});this.check();return true;
  }
  step(){
    if(this.done)return false;
    for(const j of this.jobs){
      if((j.state==="NEW"&&j.arrival<=this.time)||(j.state==="BLOCKED"&&j.wake<=this.time)){
        j.wake=null;j.level=0;j.used=0;this.enqueue(j);
      }
    }
    if(this.pending===0&&!this.locked&&this.migration===0){
      if(this.policy==="MLFQ"&&this.time>0&&this.time%32===0){
        for(const id of this.ready){const j=this.byId.get(id);j.level=0;j.used=0;}
        if(this.running!==null){const j=this.byId.get(this.running);j.level=0;j.used=0;this.enqueue(j);this.running=null;}
      }
      if(this.running!==null&&this.policy==="MLFQ"&&this.ready.length&&this.byId.get(this.ready[this.pick()]).level<this.byId.get(this.running).level){
        this.enqueue(this.byId.get(this.running),true);this.running=null;
      }
      if(this.running===null&&this.ready.length){
        const id=this.ready.splice(this.pick(),1)[0];this.running=id;this.byId.get(id).state="RUNNING";
        if(this.last!==null&&this.last!==id){this.switches++;this.pending=this.cost;this.locked=this.cost>0;this.log("CONTEXT",{from:this.last,to:id,cost:this.cost});}
      }
    }
    for(const id of this.ready)this.byId.get(id).wait++;
    if(this.migration>0){this.migration--;this.migrationTicks++;}
    else if(this.pending>0){
      this.byId.get(this.running).wait++;this.pending--;this.overhead++;
    }else if(this.running===null){this.idle++;this.last=null;}
    else {
      const j=this.byId.get(this.running);this.locked=false;this.last=j.id;if(j.first===null)j.first=this.time;
      j.left--;j.used++;j.executed++;this.busy++;
      if(j.left===0){
        if(j.index===j.bursts.length-1){j.state="DONE";j.finish=this.time+1;}
        else{j.state="BLOCKED";j.wake=this.time+1+j.bursts[j.index+1];j.index+=2;j.left=j.bursts[j.index];j.used=0;}
        this.running=null;
      }else if(j.used>=(this.policy==="FCFS"?Infinity:this.policy==="RR"?3:[2,4,8][j.level])){
        if(this.policy==="MLFQ")j.level=Math.min(2,j.level+1);
        j.used=0;this.enqueue(j);this.running=null;
      }
    }
    this.time++;this.check();return true;
  }
  check(){
    if(this.busy+this.idle+this.overhead+this.migrationTicks!==this.time)throw Error("Clock conservation");
    if(this.overhead+this.pending!==this.switches*this.cost)throw Error("Switch accounting");
    if(this.migrationTicks+this.migration!==this.migrations*this.migrationCost)throw Error("Migration accounting");
    if(this.migration>0&&this.running!==null)throw Error("Migration overlap");
    if((this.pending>0||this.locked)&&this.running===null)throw Error("Orphan switch");
    const ready=new Set(this.ready);if(ready.size!==this.ready.length||[...ready].some(id=>!this.byId.has(id)))throw Error("Invalid ready");
    let busy=0;
    for(const j of this.jobs){
      if(ready.has(j.id)!==(j.state==="READY")||(this.running===j.id)!==(j.state==="RUNNING"))throw Error("State ownership");
      if(j.left<0||j.wait<0||j.executed<0)throw Error("Negative counter");
      const cpu=j.bursts.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0);
      const rem=j.left+j.bursts.slice(j.index+2).filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0);
      if(cpu!==rem+j.executed)throw Error("Work conservation");
      if((j.state==="BLOCKED")!==(j.wake!==null))throw Error("Wake ownership");
      if(j.state==="DONE"){
        const io=j.bursts.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0);
        if(rem!==0||j.finish-j.arrival!==j.executed+j.wait+io)throw Error("Turnaround conservation");
      }busy+=j.executed;
    }
    if(busy!==this.busy)throw Error("CPU accounting");
  }
  snapshot(){
    const {byId,...state}=this;return JSON.stringify({version:3,state});
  }
  static restore(raw){
    const {version,state}=JSON.parse(raw);if(version!==3||!state)throw Error("Unsupported snapshot");
    const k=new KernelV3(state.spec,state.policy,state.cost,state.migrationCost);
    for(const key of ["migration","migrationTicks","migrations","locked","time","busy","idle","overhead","switches","last","pending","running","ready","events","jobs"])k[key]=state[key];
    k.index();k.check();return k;
  }
  run(controller=null,limit=100000){
    while(!this.done&&this.time<limit){if(controller)controller(this);this.step();}
    if(!this.done)throw Error("Tick limit");return this.metrics();
  }
  metrics(){
    if(!this.done)throw Error("Incomplete run");const mean=a=>a.reduce((x,y)=>x+y,0)/(a.length||1);
    const response=this.jobs.map(j=>j.first-j.arrival).sort((a,b)=>a-b);
    return {makespan:this.time,meanResponse:mean(response),p99Response:response.length?response[Math.ceil(.99*response.length)-1]:0,meanWait:mean(this.jobs.map(j=>j.wait)),meanTurnaround:mean(this.jobs.map(j=>j.finish-j.arrival)),overhead:this.overhead,migrationTicks:this.migrationTicks,switches:this.switches,busy:this.busy,idle:this.idle,changes:this.events.filter(e=>e.type==="POLICY").length};
  }
}


function visible(k){
  // Only completed CPU bursts and observed service are available, never left, future bursts or wake time.
  const sample=[];
  const jobs=k.jobs.filter(j=>j.state==="READY"||j.state==="RUNNING");
  for(const j of k.jobs){
    if(j.state==="NEW")continue;
    const stop=j.state==="DONE"?j.index+2:j.index;
    for(let i=0;i<stop;i+=2)sample.push(j.bursts[i]);
  }
  const prior=sample.length?sample.reduce((a,b)=>a+b,0)/sample.length:12;
  const ready=jobs.map(j=>{
    const past=j.bursts.slice(0,j.index).filter((_,i)=>i%2===0);
    const age=j.executed-past.reduce((a,b)=>a+b,0);
    const estimate=past.length?past.reduce((a,b)=>a+b,0)/past.length:prior;
    // Residual service estimate under censoring. Never inspect current true burst length.
    const remaining=Math.max(1,Math.round(age<estimate?estimate-age:estimate/2));
    return {id:j.id,left:remaining,level:j.level,used:j.used,fresh:j.first===null};
  });
  return {ready:k.ready.map(id=>ready.find(j=>j.id===id)),running:ready.find(j=>j.id===k.running)||null,last:k.last,policy:k.policy,time:k.time,cost:k.cost,migrationCost:k.migrationCost};
}

function forecast(s,policy,horizon=48,charge=true){
  const q=s.ready.map(j=>({...j}));let run=s.running?{...s.running}:null,last=s.last,pending=0,loss=0,committed=false;
  const change=policy!==s.policy;
  if(change){if(run)q.unshift(run);run=null;for(const j of q){j.level=0;j.used=0;}}
  const migration=change&&charge?s.migrationCost:0;
  for(let t=0;t<horizon;t++){
    if(t<migration){loss+=q.reduce((a,j)=>a+1+(j.fresh?1:0),0);continue;}
    if(!pending&&!committed){
      if(policy==="MLFQ"&&(s.time+t)>0&&(s.time+t)%32===0){for(const j of q){j.level=0;j.used=0;}if(run){run.level=0;run.used=0;q.push(run);run=null;}}
      if(policy==="MLFQ"&&run&&q.some(j=>j.level<run.level)){q.unshift(run);run=null;}
      if(!run&&q.length){
        const idx=policy==="MLFQ"?q.reduce((a,j,i)=>j.level<q[a].level?i:a,0):0;
        run=q.splice(idx,1)[0];if(last!==null&&last!==run.id){pending=s.cost;committed=pending>0;}
      }
    }
    loss+=q.reduce((a,j)=>a+1+(j.fresh?1:0),0);
    if(pending){loss+=1+(run.fresh?1:0);pending--;continue;}
    if(!run){last=null;continue;}
    committed=false;last=run.id;run.fresh=false;run.left--;run.used++;
    if(run.left===0)run=null;
    else if(run.used>=(policy==="FCFS"?Infinity:policy==="RR"?3:[2,4,8][run.level])){
      if(policy==="MLFQ")run.level=Math.min(2,run.level+1);run.used=0;q.push(run);run=null;
    }
  }
  return loss;
}

function predictive(k,{margin=0.08,charge=true}={}){
  if(k.time%48!==0||k.pending||k.locked||k.migration||!k.ready.length)return;
  const s=visible(k),baseline=forecast(s,k.policy,48,charge);
  let best=k.policy,value=baseline;
  for(const p of ["FCFS","RR","MLFQ"]){const v=forecast(s,p,48,charge);if(v<value){best=p;value=v;}}
  if(best!==k.policy&&baseline-value>Math.max(3,baseline*margin))k.switchPolicy(best);
}

function heuristic(k){
  if(k.time%48!==0||k.pending||k.locked||k.migration)return;
  const active=k.jobs.filter(j=>["READY","RUNNING","BLOCKED"].includes(j.state));
  const blocked=active.filter(j=>j.state==="BLOCKED").length;
  k.switchPolicy(active.length&&blocked/active.length>=.2?"MLFQ":k.cost>=2?"FCFS":"RR");
}

function heldout(seed,family,n=30){
  let s=seed>>>0;const r=n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n);};
  return Array.from({length:n},(_,i)=>{
    const io=family==="io"||family==="mixed"&&r(2)===0||family==="phase"&&i>=n/2;
    const arrival=family==="phase"?(i<n/2?r(40):180+r(35)):family==="sparse"?r(900):r(160);
    return {id:"p"+i,arrival,bursts:io?[1+r(5),8+r(35),1+r(5),8+r(35),1+r(5)]:[8+r(55)]};
  });
}

function verifyV3(){
  const assert=(x,m)=>{if(!x)throw Error(m);};let fixtures=0;
  const pair=[{id:"a",arrival:0,bursts:[3]},{id:"b",arrival:0,bursts:[2]}];
  let k=new KernelV3(pair,"FCFS",2,3);
  assert(k.switchPolicy("RR"),"Migration accepted");k.step();assert(k.migration===2&&k.migrationTicks===1&&!k.switchPolicy("FCFS"),"Migration guard");
  let restored=KernelV3.restore(k.snapshot());assert(JSON.stringify(k.run())===JSON.stringify(restored.run())&&k.snapshot()===restored.snapshot(),"Migration replay");assert(k.time===10,"Exact total cost");fixtures++;
  k=new KernelV3(pair,"RR",2,3);for(let i=0;i<5;i++)k.step();assert(k.locked&&k.pending===0&&!k.switchPolicy("FCFS"),"Dispatch commitment");k.step();assert(!k.locked&&k.byId.get("b").first===5,"First instruction guaranteed");fixtures++;
  // Causal masking: vary undisclosed current/future burst lengths and future arrival.
  const a=new KernelV3([{id:"a",arrival:0,bursts:[10,5,1]},{id:"b",arrival:0,bursts:[11]},{id:"z",arrival:50,bursts:[5]}]),
        b=new KernelV3([{id:"a",arrival:0,bursts:[90,80,100]},{id:"b",arrival:0,bursts:[120]},{id:"z",arrival:500,bursts:[240]}]);
  a.step();b.step();assert(JSON.stringify(visible(a))===JSON.stringify(visible(b)),"Future leakage");fixtures++;
  const policies=["FCFS","RR","MLFQ","HEUR","PRED","NO_MARGIN","NO_FORECAST_COST"],rows=[];
  for(const family of ["cpu","io","mixed","phase","sparse"])for(const cost of [0,1,3])for(let seed=101;seed<=108;seed++){
    const spec=heldout(seed,family),results={};
    for(const p of policies){
      k=new KernelV3(spec,policies.indexOf(p)<3?p:"RR",cost,2);
      results[p]=k.run(p==="HEUR"?heuristic:p==="PRED"?predictive:p==="NO_MARGIN"?q=>predictive(q,{margin:0}):p==="NO_FORECAST_COST"?q=>predictive(q,{charge:false}):null);
    }
    const score=m=>(m.meanResponse/Math.max(1,results.RR.meanResponse)+m.meanTurnaround/Math.max(1,results.RR.meanTurnaround))/2;
    const best=Math.min(...policies.slice(0,3).map(p=>score(results[p]))),scores=Object.fromEntries(policies.map(p=>[p,score(results[p])]));
    rows.push({family,cost,seed,best,scores,results});
  }
  const aggregates=Object.fromEntries(policies.map(p=>[p,{meanScore:rows.reduce((a,r)=>a+r.scores[p],0)/rows.length,wins:rows.filter(r=>r.scores[p]<r.best-1e-9).length,ties:rows.filter(r=>Math.abs(r.scores[p]-r.best)<1e-9).length,meanChanges:rows.reduce((a,r)=>a+r.results[p].changes,0)/rows.length}]));
  const byFamily=Object.fromEntries([...new Set(rows.map(r=>r.family))].map(f=>[f,Object.fromEntries(["HEUR","PRED"].map(p=>[p,rows.filter(r=>r.family===f&&r.scores[p]<r.best-1e-9).length]))]));
  return {fixtures,groups:rows.length,runs:rows.length*policies.length,aggregates,byFamily,rows};
}

export {KernelV3,visible,forecast,predictive,heuristic,heldout,verifyV3};
