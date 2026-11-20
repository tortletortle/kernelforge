import { KernelV3 } from './src/kernel-v3.mjs';
import { controller, workload4 } from './src/kernel-v4.mjs';
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
  }
];
function diagnostic(){
 const configs=[
 {name:"reference",start:"MLFQ",config:{...grid[0]}},
 {name:"response_only",start:"MLFQ",config:{...grid[0],responseWeight:4}},
 {name:"turnaround_only",start:"MLFQ",config:{...grid[0],turnaround:true}},
 {name:"aligned",start:"MLFQ",config:{...grid[1]}},
 {name:"aligned_RR",start:"RR",config:{...grid[1]}},
 {name:"add_survival",start:"MLFQ",config:{...grid[1],survival:true}},
 {name:"add_wake",start:"MLFQ",config:{...grid[1],wake:true}},
 {name:"add_arrival",start:"MLFQ",config:{...grid[1],arrival:true}},
 {name:"short_interval",start:"MLFQ",config:{...grid[1],interval:24}},
 {name:"add_dwell",start:"MLFQ",config:{...grid[1],dwell:48}}
 ];
 const rows=[];
 for(const family of ["phase","reverse"])for(const cost of [0,1,3])for(let seed=401;seed<=406;seed++){
  const spec=workload4(seed,family),rr=new KernelV3(spec,"RR",cost,2).run(),mlfq=new KernelV3(spec,"MLFQ",cost,2).run(),score=m=>(m.meanResponse/Math.max(1,rr.meanResponse)+m.meanTurnaround/Math.max(1,rr.meanTurnaround))/2;
  const result={MLFQ:score(mlfq)};
  for(const c of configs){const k=new KernelV3(spec,c.start,cost,2);result[c.name]=score(k.run(controller(c.config).run));}
  rows.push({family,cost,seed,result});
 }
 const means=Object.fromEntries(["MLFQ",...configs.map(c=>c.name)].map(name=>[name,rows.reduce((s,r)=>s+r.result[name],0)/rows.length]));
 return {groups:rows.length,runs:rows.length*(configs.length+2),means,rows};
}
export {diagnostic};
