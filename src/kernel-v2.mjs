// KernelForge V0.2: isolated single-CPU overhead and snapshot experiment.
class KernelV2 {
  constructor(spec, policy="RR", cost=0){
    if(!["FCFS","RR","MLFQ"].includes(policy)||!Number.isSafeInteger(cost)||cost<0)throw Error("Invalid configuration");
    if(!Array.isArray(spec)||new Set(spec.map(x=>x.id)).size!==spec.length)throw Error("Duplicate IDs");
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
    if(this.pending!==0)return false;
    if(next===this.policy)return true;
    if(this.running!==null){this.enqueue(this.byId.get(this.running),true);this.running=null;}
    const old=this.policy;this.policy=next;for(const j of this.jobs){j.level=0;j.used=0;}
    this.log("POLICY",{old,next});this.check();return true;
  }
  step(){
    if(this.done)return false;
    for(const j of this.jobs){
      if((j.state==="NEW"&&j.arrival<=this.time)||(j.state==="BLOCKED"&&j.wake<=this.time)){
        j.wake=null;j.level=0;j.used=0;this.enqueue(j);
      }
    }
    if(this.pending===0){
      if(this.policy==="MLFQ"&&this.time>0&&this.time%32===0){
        for(const id of this.ready){const j=this.byId.get(id);j.level=0;j.used=0;}
        if(this.running!==null){const j=this.byId.get(this.running);j.level=0;j.used=0;this.enqueue(j);this.running=null;}
      }
      if(this.running!==null&&this.policy==="MLFQ"&&this.ready.length&&this.byId.get(this.ready[this.pick()]).level<this.byId.get(this.running).level){
        this.enqueue(this.byId.get(this.running),true);this.running=null;
      }
      if(this.running===null&&this.ready.length){
        const id=this.ready.splice(this.pick(),1)[0];this.running=id;this.byId.get(id).state="RUNNING";
        if(this.last!==null&&this.last!==id){this.switches++;this.pending=this.cost;this.log("CONTEXT",{from:this.last,to:id,cost:this.cost});}
      }
    }
    for(const id of this.ready)this.byId.get(id).wait++;
    if(this.pending>0){
      this.byId.get(this.running).wait++;this.pending--;this.overhead++;
    }else if(this.running===null){this.idle++;this.last=null;}
    else {
      const j=this.byId.get(this.running);this.last=j.id;if(j.first===null)j.first=this.time;
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
    if(this.busy+this.idle+this.overhead!==this.time)throw Error("Clock conservation");
    if(this.overhead+this.pending!==this.switches*this.cost)throw Error("Switch accounting");
    if(this.pending>0&&this.running===null)throw Error("Orphan switch");
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
    const {byId,...state}=this;return JSON.stringify({version:1,state});
  }
  static restore(raw){
    const {version,state}=JSON.parse(raw);if(version!==1||!state)throw Error("Unsupported snapshot");
    const k=new KernelV2(state.spec,state.policy,state.cost);
    for(const key of ["time","busy","idle","overhead","switches","last","pending","running","ready","events","jobs"])k[key]=state[key];
    k.index();k.check();return k;
  }
  run(controller=null,limit=100000){
    while(!this.done&&this.time<limit){if(controller)controller(this);this.step();}
    if(!this.done)throw Error("Tick limit");return this.metrics();
  }
  metrics(){
    if(!this.done)throw Error("Incomplete run");const mean=a=>a.reduce((x,y)=>x+y,0)/(a.length||1);
    const response=this.jobs.map(j=>j.first-j.arrival).sort((a,b)=>a-b);
    return {makespan:this.time,meanResponse:mean(response),p99Response:response.length?response[Math.ceil(.99*response.length)-1]:0,meanWait:mean(this.jobs.map(j=>j.wait)),meanTurnaround:mean(this.jobs.map(j=>j.finish-j.arrival)),overhead:this.overhead,switches:this.switches,busy:this.busy,idle:this.idle,changes:this.events.filter(e=>e.type==="POLICY").length};
  }
}

function generate(seed,family,n=30){
  let s=seed>>>0;const r=n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return Math.floor(s/4294967296*n);};
  return Array.from({length:n},(_,i)=>{
    const io=family==="io"||family==="mixed"&&i%2===0||family==="burst"&&i>=n/2;
    const arrival=family==="burst"?(i<n/2?r(20):120+r(10)):r(180);
    return {id:"p"+i,arrival,bursts:io?[1+r(4),6+r(25),1+r(4),6+r(25),1+r(4)]:[12+r(40)]};
  });
}

function adaptive(k){
  // Causal threshold heuristic, not learned or tuned against this test set.
  if(k.time%48!==0||k.pending!==0)return;
  const active=k.jobs.filter(j=>j.state==="READY"||j.state==="RUNNING"||j.state==="BLOCKED");
  const blocked=active.filter(j=>j.state==="BLOCKED").length;
  const next=active.length>0&&blocked/active.length>=0.2?"MLFQ":k.cost>=2?"FCFS":"RR";
  k.switchPolicy(next);
}

function verifyV2(){
  const check=(x,m)=>{if(!x)throw Error(m);};let cases=0;
  const pair=[{id:"a",arrival:0,bursts:[3]},{id:"b",arrival:0,bursts:[2]}];
  let k=new KernelV2(pair,"FCFS",2);let m=k.run();check(m.makespan===7&&m.overhead===2&&m.meanResponse===2.5,"Exact switch cost");cases++;
  k=new KernelV2(pair,"RR",2);for(let i=0;i<4;i++)k.step();check(k.pending===1,"Mid-overhead fixture");check(k.switchPolicy("MLFQ")===false,"Busy migration guard");
  let restored=KernelV2.restore(k.snapshot());check(JSON.stringify(k.run())===JSON.stringify(restored.run())&&k.snapshot()===restored.snapshot(),"Mid-overhead replay");cases++;
  k=new KernelV2([{id:"x",arrival:4,bursts:[2,5,1]}],"FCFS",3);m=k.run();check(m.makespan===12&&m.idle===9&&m.overhead===0,"Idle and I/O fixture");cases++;
  const rows=[],families=["cpu","io","mixed","burst"],policies=["FCFS","RR","MLFQ","ADAPT"];
  for(const family of families)for(const cost of [0,1,3])for(let seed=1;seed<=12;seed++){
    const spec=generate(seed,family),results={};
    for(const policy of policies){
      k=new KernelV2(spec,policy==="ADAPT"?"RR":policy,cost);
      results[policy]=k.run(policy==="ADAPT"?adaptive:null);cases++;
    }
    // Randomized policy changes with a reproducible clock and snapshot fork.
    k=new KernelV2(spec,"RR",cost);
    const driver=q=>{if(q.time%17===0)q.switchPolicy(policies[(q.time/17+seed)%3]);};
    for(let t=0;t<73&&!k.done;t++){driver(k);k.step();}
    restored=KernelV2.restore(k.snapshot());
    check(JSON.stringify(k.run(driver))===JSON.stringify(restored.run(driver))&&k.snapshot()===restored.snapshot(),"Branch replay "+family+seed+cost);cases++;
    rows.push({family,cost,seed,results});
  }
  const summary=[];
  for(const family of families)for(const cost of [0,1,3]){
    const subset=rows.filter(r=>r.family===family&&r.cost===cost);
    const metrics=Object.fromEntries(policies.map(p=>[p,Object.fromEntries(["meanResponse","meanTurnaround","overhead","changes"].map(key=>[key,Math.round(100*subset.reduce((a,r)=>a+r.results[p][key],0)/subset.length)/100]))]));
    // Explicit illustrative equal-weight response and turnaround score, normalized to RR per paired seed.
    const score=(m,b)=>(m.meanResponse/Math.max(1,b.meanResponse)+m.meanTurnaround/Math.max(1,b.meanTurnaround))/2;
    const wins=subset.filter(r=>score(r.results.ADAPT,r.results.RR)<Math.min(...policies.slice(0,3).map(p=>score(r.results[p],r.results.RR)))).length;
    summary.push({family,cost,metrics,adaptWinsAgainstBestStatic:wins});
  }
  return {cases,pairedWorkloads:rows.length,summary};
}

export {KernelV2,generate,adaptive,verifyV2};
