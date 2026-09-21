import { createInterface } from 'node:readline';
import { normalizeFacts } from '../stock-ai/financial-facts.js';
for await (const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
  try {
    const {raw,cik,symbol}=JSON.parse(line);
    if(Number(raw.cik)!==cik)throw Error('issuer_identity_mismatch');
    const item=normalizeFacts(raw,symbol,process.argv[2]);
    for(const s of Object.values(item.series)){s.annual=s.annual.slice(0,1);s.quarter=s.quarter.slice(0,1);}
    process.stdout.write(JSON.stringify({ok:true,item})+'\n');
  }catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n');}
}
