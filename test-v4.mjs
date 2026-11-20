import {verifyV4} from './src/kernel-v4.mjs';
import {diagnostic} from './src/v4-diagnostic.mjs';
const r=process.argv.includes('--diagnostic')?diagnostic():verifyV4();
if(process.argv.includes('--full'))console.log(JSON.stringify(r,null,2));
else {const {rows,...summary}=r;console.log(JSON.stringify(summary,null,2));}
