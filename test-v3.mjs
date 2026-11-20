import { verifyV3 } from './src/kernel-v3.mjs';
const report=verifyV3();
if(process.argv.includes('--full')) console.log(JSON.stringify(report,null,2));
else { const {rows,...summary}=report; console.log(JSON.stringify(summary,null,2)); }
