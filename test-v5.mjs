import {evaluate5} from './src/kernel-v5.mjs';
const r=evaluate5();
if(process.argv.includes('--full'))console.log(JSON.stringify(r,null,2));
else {const {rows,...summary}=r;console.log(JSON.stringify(summary,null,2));}
