// KernelForge v0.1 — deterministic single-CPU tick simulator, not a Linux kernel.
class Kernel {
  constructor(jobs, policy="RR") {
    if (!["FCFS","RR","MLFQ"].includes(policy)) throw Error("Unknown policy");
    if (!Array.isArray(jobs) || new Set(jobs.map(j=>j.id)).size!==jobs.length) throw Error("Duplicate job ID");
    this.policy=policy; this.time=0; this.ready=[]; this.running=null; this.events=[]; this.busy=0; this.switches=0; this.lastCPU=null;
    this.jobs=jobs.map(j=>{
      if(typeof j.id!=="string" || !Number.isSafeInteger(j.arrival)||j.arrival<0||!Array.isArray(j.bursts)||j.bursts.length%2!==1||!j.bursts.every(n=>Number.isSafeInteger(n)&&n>0))throw Error("Invalid job");
      return {id:j.id,arrival:j.arrival,bursts:[...j.bursts],index:0,left:j.bursts[0],state:"NEW",level:0,used:0,executed:0,wait:0,first:null,finish:null,wake:null};
    }); this.byId=new Map(this.jobs.map(j=>[j.id,j]));
  }
  log(type,id=null,details={}) {this.events.push({time:this.time,type,id,...details});}
  enqueue(j,front=false){j.state="READY"; if(front)this.ready.unshift(j.id);else this.ready.push(j.id);}
  quantum(j){return this.policy==="FCFS"?Infinity:this.policy==="RR"?3:[2,4,8][j.level];}
  pick(){if(this.policy!=="MLFQ")return 0;return this.ready.reduce((best,id,i)=>this.byId.get(id).level<this.byId.get(this.ready[best]).level?i:best,0);}
  changePolicy(next){
    if(!["FCFS","RR","MLFQ"].includes(next))throw Error("Unknown policy");
    this.assertState(); if(next===this.policy)return;
    const previous=this.policy;
    if(this.running!==null){this.enqueue(this.byId.get(this.running),true);this.running=null;}
    for(const j of this.jobs){j.level=0;j.used=0;}
    this.policy=next;this.log("POLICY",null,{previous,next});this.assertState();
  }
  step(){
    for(const j of this.jobs){
      if(j.state==="NEW"&&j.arrival<=this.time || j.state==="BLOCKED"&&j.wake<=this.time){
        j.wake=null;j.level=0;j.used=0;this.enqueue(j);this.log("READY",j.id);
      }
    }
    if(this.policy==="MLFQ"&&this.time>0&&this.time%24===0){
      for(const id of this.ready){const j=this.byId.get(id);j.level=0;j.used=0;}
      if(this.running!==null){const j=this.byId.get(this.running);j.level=0;j.used=0;this.enqueue(j);this.running=null;}
      this.log("BOOST");
    }
    if(this.running!==null&&this.policy==="MLFQ"&&this.ready.length&&this.byId.get(this.ready[this.pick()]).level<this.byId.get(this.running).level){
      this.enqueue(this.byId.get(this.running),true);this.running=null;
    }
    if(this.running===null&&this.ready.length){
      this.running=this.ready.splice(this.pick(),1)[0];const j=this.byId.get(this.running);j.state="RUNNING";if(j.first===null)j.first=this.time;this.log("DISPATCH",j.id);
    }
    for(const id of this.ready)this.byId.get(id).wait++;
    if(this.running===null){this.lastCPU=null;}else{
      const j=this.byId.get(this.running);if(this.lastCPU!==null&&this.lastCPU!==j.id)this.switches++;this.lastCPU=j.id;
      j.left--;j.used++;j.executed++;this.busy++;
      if(j.left===0){
        if(j.index===j.bursts.length-1){j.state="DONE";j.finish=this.time+1;this.log("DONE",j.id,{boundary:j.finish});}
        else{j.state="BLOCKED";j.wake=this.time+1+j.bursts[j.index+1];j.index+=2;j.left=j.bursts[j.index];j.used=0;this.log("BLOCK",j.id,{wake:j.wake});}
        this.running=null;
      }else if(j.used>=this.quantum(j)){
        if(this.policy==="MLFQ")j.level=Math.min(2,j.level+1);j.used=0;this.enqueue(j);this.running=null;
      }
    }
    this.time++;this.assertState();
  }
  assertState(){
    const ready=new Set(this.ready);if(ready.size!==this.ready.length)throw Error("Duplicate ready");
    if(this.jobs.filter(j=>j.state==="RUNNING").length!==(this.running===null?0:1))throw Error("Running count");
    let total=0;
    for(const j of this.jobs){
      if(ready.has(j.id)!==(j.state==="READY") || (this.running===j.id)!==(j.state==="RUNNING"))throw Error("Queue/state mismatch");
      if(j.left<0||j.executed<0||j.wait<0)throw Error("Negative counter");
      const cpu=j.bursts.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0);
      const remaining=j.left+j.bursts.slice(j.index+2).filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0);
      if(j.executed+remaining!==cpu)throw Error("CPU work lost or duplicated");
      if(j.state==="DONE"&&(j.finish===null||remaining!==0))throw Error("Bad completion");
      if((j.state==="BLOCKED")!==(j.wake!==null))throw Error("Wake mismatch");
      total+=j.executed;
    }
    if(total!==this.busy||total>this.time)throw Error("CPU accounting mismatch");
  }
  run(limit=100000){while(this.jobs.some(j=>j.state!=="DONE")&&this.time<limit)this.step();if(this.jobs.some(j=>j.state!=="DONE"))throw Error("Simulation limit reached");return this.metrics();}
  metrics(){
    const done=this.jobs.filter(j=>j.state==="DONE");
    if(done.length!==this.jobs.length)throw Error("Metrics require completed workload");
    const response=done.map(j=>j.first-j.arrival).sort((a,b)=>a-b);
    const avg=a=>a.reduce((x,y)=>x+y,0)/(a.length||1);
    return {jobs:done.length,makespan:this.time,cpuTicks:this.busy,contextSwitches:this.switches,meanWait:avg(done.map(j=>j.wait)),meanResponse:avg(response),p99Response:response.length?response[Math.ceil(.99*response.length)-1]:0,meanTurnaround:avg(done.map(j=>j.finish-j.arrival))};
  }
}

function workload(seed,count=60){
  let s=seed>>>0;const r=n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s%n;};
  return Array.from({length:count},(_,i)=>({id:"p"+i,arrival:r(80),bursts:i%3===0?[1+r(3),4+r(12),1+r(3),4+r(12),1+r(3)]:i%3===1?[12+r(25)]:[3+r(5),2+r(6),3+r(5)]}));
}

function verify(){
  const check=(cond,msg)=>{if(!cond)throw Error(msg);};
  let n=0;const fixture=[{id:"a",arrival:0,bursts:[2,3,1]}];
  const k=new Kernel(fixture);const m=k.run();check(m.makespan===6&&m.cpuTicks===3&&m.meanWait===0,"I/O exact timing");n++;
  const rr=new Kernel([{id:"a",arrival:0,bursts:[5]},{id:"b",arrival:0,bursts:[1]}]);rr.run();check(rr.byId.get("b").first===3,"RR quantum fixture");n++;
  const rows=[];
  for(let seed=1;seed<=20;seed++){
    const jobs=workload(seed);const cpu=jobs.flatMap(j=>j.bursts.filter((_,i)=>i%2===0)).reduce((a,b)=>a+b,0);
    const sample={seed};
    for(const p of ["FCFS","RR","MLFQ","HOT"]){
      const k=new Kernel(jobs,p==="HOT"?"RR":p);
      if(p==="HOT"){for(let t=0;t<120;t++)k.step();k.changePolicy("MLFQ");for(let t=0;t<120;t++)k.step();k.changePolicy("RR");}
      const m=k.run();check(m.cpuTicks===cpu&&m.jobs===jobs.length,"Conservation "+seed+" "+p);
      for(const j of k.jobs){const io=j.bursts.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0);check(j.finish-j.arrival===j.executed+j.wait+io,"Turnaround identity "+j.id);}
      if(p==="HOT")check(k.events.filter(e=>e.type==="POLICY").length===2,"Missing policy change");
      sample[p]=m;n++;
    }
    rows.push(sample);
  }
  const a=new Kernel(workload(42),"MLFQ"),b=new Kernel(workload(42),"MLFQ");check(JSON.stringify(a.run())===JSON.stringify(b.run())&&JSON.stringify(a.events)===JSON.stringify(b.events),"Determinism");n++;
  return {cases:n,means:Object.fromEntries(["FCFS","RR","MLFQ","HOT"].map(p=>[p,Object.fromEntries(["meanWait","meanResponse","p99Response","meanTurnaround","contextSwitches"].map(key=>[key,rows.reduce((a,x)=>a+x[p][key],0)/rows.length]))]))};
}

export {Kernel, workload, verify};
