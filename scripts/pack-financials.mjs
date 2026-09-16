import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { normalizeFacts, FINANCIAL_VERSION } from '../stock-ai/financial-facts.js';
const symbols = ['MSFT','GOOGL','KO','NVDA','AVGO','ETN','GEV','VRT','CCJ','ORCL'];
const path = 'stock-ai/data/financials.json', generatedAt = new Date().toISOString();
let previous = { companies: [] };
try { previous = JSON.parse(await readFile(path,'utf8')); } catch {}
const companies = [];
let success = 0;
for (const symbol of symbols) {
  try {
    const raw = JSON.parse(await readFile(`${process.argv[2]}/${symbol}.json`,'utf8'));
    const item = normalizeFacts(raw, symbol, generatedAt);
    companies.push(item); success++;
  } catch {
    const old = previous.companies.find(x => x.symbol === symbol);
    companies.push(old ? { ...old, status: 'cached', error: '本次更新失败，保留旧快照' } : { symbol, status: 'unavailable', error: '本次未取得 SEC 数据' });
  }
}
if (!success) throw new Error('No SEC responses: previous snapshot preserved');
await mkdir('stock-ai/data',{ recursive:true });
await writeFile(path+'.tmp', JSON.stringify({ version:FINANCIAL_VERSION, generatedAt, companies },null,2)+'\n');
await rename(path+'.tmp',path);
console.log(`Packed ${success}/${symbols.length} SEC responses; no scores or trades generated.`);
