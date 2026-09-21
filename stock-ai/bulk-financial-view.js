import { validateProgress,findCompanies } from './bulk-financials.js';
import { snapshotState,FINANCIAL_VERSION } from './financial-facts.js';
const $=id=>document.getElementById(id),labels={available:'可用（至少一项）',unsupported:'暂不支持',failed:'处理失败',not_in_archive:'本次包中无财报'};
if($('bulk-panel')){
 let report=null,generation=0;const cache=new Map();
 function results(){
  if(!report)return;generation++;$('bulk-detail').replaceChildren();$('bulk-results').replaceChildren();
  const matches=findCompanies(report.entries,$('bulk-query').value,$('bulk-filter').value);$('bulk-matches').textContent=`匹配 ${matches.length} 家，显示前20家；完整代码优先显示。`;
  for(const item of matches.slice(0,20)){const b=document.createElement('button');b.type='button';b.className='ghost bulk-result';b.textContent=`${item.symbols.join(' / ')} · ${item.name||'CIK '+item.cik} · ${labels[item.status]}`;b.onclick=()=>detail(item);$('bulk-results').append(b);}
 }
 async function detail(entry){
  const request=++generation,root=$('bulk-detail');root.replaceChildren();const h=document.createElement('h4');h.textContent=entry.symbols.join(' / ');root.append(h);const note=document.createElement('p');root.append(note);
  if(entry.status!=='available'){note.textContent=entry.reason||labels[entry.status];return;}
  note.textContent='正在读取公司财报…';
  try{
   const shard=entry.cik%64;let d=cache.get(shard);
   if(!d){const r=await fetch(new URL(`./data/bulk/companies-${shard}.json`,import.meta.url),{cache:'no-cache',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('download');d=await r.json();if(d.version!=='sec-bulk-v1'||d.runId!==report.runId)throw Error('version');cache.set(shard,d);if(cache.size>4)cache.delete(cache.keys().next().value);}
   if(request!==generation)return;const item=d.companies?.[entry.cik];
   if(!item||item.cik!==entry.cik||snapshotState({version:FINANCIAL_VERSION,generatedAt:report.retrievedAt,companies:[{...item,symbol:'CHECK'}]})==='invalid')throw Error('data');
   note.textContent=`采集于 ${new Date(item.retrievedAt).toLocaleString('zh-CN')}；展示最近可取得的直接单季和全年数据，不保证是最新公告。`;
   for(const [key,label] of Object.entries({revenue:'营收',eps:'稀释每股收益',operatingCashFlow:'经营现金流',capex:'购置固定资产现金支出'})){
    const facts=[...item.series[key].quarter.slice(0,1),...item.series[key].annual.slice(0,1)];if(!facts.length){const p=document.createElement('p');p.textContent=label+'：缺项';root.append(p);}
    for(const f of facts){const row=document.createElement('div');row.className='financial-row';const name=document.createElement('span'),value=document.createElement('strong'),source=document.createElement('a');name.textContent=`${label} · ${f.period==='quarter'?'单季':'全年'} ${f.start} 至 ${f.end}`;value.textContent=f.unit==='USD/shares'?`${f.value.toLocaleString('zh-CN')} 美元/股`:`${(f.value/1e8).toLocaleString('zh-CN',{maximumFractionDigits:2})} 亿美元`;source.textContent=`申报 ${f.filed} · ${f.form}`;source.href=`https://www.sec.gov/Archives/edgar/data/${item.cik}/${f.accession.replaceAll('-','')}/${f.accession}-index.html`;source.target='_blank';source.rel='noopener';row.append(name,value,source);root.append(row);}
   }
  }catch{if(request===generation)note.textContent='公司财报读取失败或版本正在更新，请重新读取进度后再试；持仓不受影响。';}
 }
 async function load(){
  $('bulk-refresh').disabled=true;
  try{const r=await fetch(new URL('./data/bulk/progress.json',import.meta.url),{cache:'no-cache',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('download');const d=await r.json();if(!validateProgress(d))throw Error('data');report=d;cache.clear();generation++;
   if(d.phase==='blocked'){
    for(const k of ['total','completed','available','failed','unsupported','pending'])$('bulk-'+k).textContent='—';
    $('bulk-progress').value=0;$('bulk-status').textContent=d.updateError+' · 尝试时间 '+new Date(d.lastAttemptAt).toLocaleString('zh-CN');
    $('bulk-scope').textContent='本次未取得全量文件，无法确认当前总数和完成数。现有多年历史财报仍可在下方查看。';
    $('bulk-reasons').textContent='数据源拒绝自动访问或暂时不可用；没有填充估计数。需要恢复正规访问或导入官方全量包后再运行。';
    $('bulk-results').replaceChildren();$('bulk-detail').replaceChildren();$('bulk-matches').textContent='全量查询等待数据恢复。';return;
   }

   for(const k of ['total','completed','available','failed','unsupported','pending'])$('bulk-'+k).textContent=d.counts[k].toLocaleString('zh-CN');$('bulk-progress').max=Math.max(1,d.counts.total);$('bulk-progress').value=d.counts.completed;
   const phase={processing:'处理中（发布时状态）',interrupted:'已中断，可恢复',completed:'本轮文件全部处理完毕',completed_with_errors:'本轮处理结束，仍有失败文件'}[d.phase];
   $('bulk-status').textContent=`${phase}${d.updateError?' · 本次更新失败，以下为旧统计':''} · 统计时间 ${new Date(d.updatedAt).toLocaleString('zh-CN')}${Date.now()-Date.parse(d.updatedAt)>7*86400000?' · 超过7天，待更新':''}`;
   $('bulk-scope').textContent=`扫描整个 SEC companyfacts 包，含历史及退市发行人，不是可交易股票池。代码目录共 ${d.listedDirectoryCompanies} 家公司，其中 ${d.directoryMissingFromArchive} 家在包中无财报。下方查询已处理的代码目录公司。`;
   const reasonNames={'Invalid SEC identity or time':'缺少公司名称或有效身份字段','issuer_identity_mismatch':'公司编号与文件名不一致'};
   $('bulk-reasons').textContent=Object.entries(d.failureReasons||{}).map(([k,n])=>`${reasonNames[k]||'其他解析错误'} ${n} 份`).join('；')+'。暂不支持表示未找到当前支持的美元 US-GAAP 标准科目，可能采用其他币种或会计准则。';results();
  }catch{$('bulk-status').textContent='扫描统计读取失败；'+(report?'保留上次统计，不能视为当前进度。':'暂不显示扫描数量。')+'持仓不受影响。';}
  finally{setTimeout(()=>{$('bulk-refresh').disabled=false;},15000);}
 }
 $('bulk-search').onsubmit=e=>{e.preventDefault();results();};$('bulk-filter').onchange=results;$('bulk-refresh').onclick=load;load();
}
