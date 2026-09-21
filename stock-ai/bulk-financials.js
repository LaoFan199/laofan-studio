export function validateProgress(d){
 if(d?.version==='sec-bulk-v1'&&d.phase==='blocked')return d.counts===null&&Array.isArray(d.entries)&&d.entries.length===0&&typeof d.updateError==='string'&&Number.isFinite(Date.parse(d.lastAttemptAt));
 if(d?.version!=='sec-bulk-v1'||!/^[a-f0-9]{16}$/.test(d.runId||'')||!['processing','interrupted','completed','completed_with_errors'].includes(d.phase)||!Array.isArray(d.entries)||!Number.isFinite(Date.parse(d.updatedAt))||Date.parse(d.updatedAt)>Date.now()+60000||!Number.isFinite(Date.parse(d.retrievedAt)))return false;
 const c=d.counts;if(!c||['total','completed','available','unsupported','failed','pending'].some(k=>!Number.isSafeInteger(c[k])||c[k]<0))return false;
 if(c.total!==c.completed+c.pending||c.completed!==c.available+c.failed+c.unsupported||d.phase.startsWith('completed')&&c.pending!==0||d.phase==='completed'&&c.failed!==0)return false;
 return d.entries.every(x=>Number.isSafeInteger(x.cik)&&x.cik>0&&typeof x.name==='string'&&Array.isArray(x.symbols)&&x.symbols.length&&x.symbols.every(s=>typeof s==='string')&&['available','unsupported','failed','not_in_archive'].includes(x.status));
}
export function findCompanies(entries,query,status='all'){
 const q=query.trim().toUpperCase();return entries.filter(x=>(status==='all'||x.status===status)&&(!q||x.symbols.some(s=>s.toUpperCase().includes(q))||String(x.cik)===q||x.name.toUpperCase().includes(q))).sort((a,b)=>Number(b.symbols.includes(q))-Number(a.symbols.includes(q))||a.symbols[0].localeCompare(b.symbols[0]));
}
