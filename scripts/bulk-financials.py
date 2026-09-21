"""Full SEC scan; resumable maintenance job, not a browser/serverless task."""
import argparse,collections,datetime,hashlib,json,os,pathlib,re,subprocess,time,urllib.request,zipfile
URL='https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip'
MAPPING='https://www.sec.gov/files/company_tickers.json'
HEADERS={'User-Agent':os.environ.get('SEC_USER_AGENT','LaoFanStudioResearch/0.1 (https://github.com/LaoFan199/laofan-studio)')}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
def save(path,value):
 p=pathlib.Path(path);p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n');tmp.replace(p)
def download(cache):
 target=cache/'companyfacts.zip';part=cache/'companyfacts.zip.part';mp=cache/'download.json'
 with urllib.request.urlopen(urllib.request.Request(URL,headers=HEADERS,method='HEAD'),timeout=40) as r:meta={'etag':r.headers.get('ETag'),'totalBytes':int(r.headers['Content-Length']),'lastModified':r.headers.get('Last-Modified'),'url':URL}
 old=json.loads(mp.read_text()) if mp.exists() else {};same=bool(meta['etag']) and old==meta
 if same and target.exists() and target.stat().st_size==meta['totalBytes']:return target,meta
 offset=part.stat().st_size if same and part.exists() else 0
 if offset>=meta['totalBytes']:offset=0
 headers=dict(HEADERS)
 if offset:headers.update({'Range':f'bytes={offset}-','If-Range':meta['etag']})
 with urllib.request.urlopen(urllib.request.Request(URL,headers=headers),timeout=60) as r:
  if r.headers.get('ETag') and meta['etag'] and r.headers['ETag']!=meta['etag']:raise RuntimeError('Archive changed during download')
  if offset and r.status==206 and not r.headers.get('Content-Range','').startswith(f'bytes {offset}-'):raise RuntimeError('Invalid range response')
  if offset and r.status==200:offset=0
  save(mp,meta);count=offset;last=0
  with open(part,'ab' if offset else 'wb') as f:
   while True:
    block=r.read(1024*1024)
    if not block:break
    f.write(block);count+=len(block)
    if time.monotonic()-last>10:
     save(cache/'download-progress.json',{'downloadedBytes':count,**meta,'updatedAt':now()});print('Download',count,'/',meta['totalBytes'],flush=True);last=time.monotonic()
 if count!=meta['totalBytes']:raise RuntimeError('Incomplete archive; partial retained')
 part.replace(target);return target,meta

def counts(results,total):
 c={k:sum(x['status']==k for x in results.values()) for k in ['available','unsupported','failed']};c.update(total=total,completed=len(results),pending=total-len(results))
 if sum(c[k] for k in ['available','unsupported','failed'])!=c['completed'] or c['pending']<0:raise ValueError('Invalid counters')
 return c

def main():
 p=argparse.ArgumentParser();p.add_argument('--cache',required=True);p.add_argument('--archive');p.add_argument('--resume',action='store_true');p.add_argument('--retry-failed',action='store_true');p.add_argument('--output',default='stock-ai/data/bulk');a=p.parse_args()
 cache=pathlib.Path(a.cache);cache.mkdir(parents=True,exist_ok=True);out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
 if a.archive:archive=pathlib.Path(a.archive);meta={'url':URL,'totalBytes':archive.stat().st_size}
 else:archive,meta=download(cache)
 mp=cache/'ticker-map.json'
 if not a.resume or not mp.exists():
  with urllib.request.urlopen(urllib.request.Request(MAPPING,headers=HEADERS),timeout=40) as r:save(mp,json.load(r))
 symbols={}
 for row in json.loads(mp.read_text()).values():symbols.setdefault(int(row['cik_str']),[]).append(row['ticker'])
 h=hashlib.sha256()
 with open(archive,'rb') as f:
  for b in iter(lambda:f.read(4*1024*1024),b''):h.update(b)
 digest=h.hexdigest();identity=digest+':'+hashlib.sha256(mp.read_bytes()).hexdigest()+':sec-bulk-v1'
 cp=cache/'scan-checkpoint.json';old=json.loads(cp.read_text()) if a.resume and cp.exists() else {};same=old.get('identity')==identity
 results=old.get('results',{}) if same else {};started=old['startedAt'] if same else now();retrieved=old['retrievedAt'] if same else now();run=hashlib.sha256((identity+started).encode()).hexdigest()[:16]
 records=cache/('records-'+digest[:12]);records.mkdir(exist_ok=True)
 results={k:v for k,v in results.items() if not(a.retry_failed and v['status']=='failed') and (v['status']=='failed' or int(k) not in symbols or (records/f'{k}.json').exists())}
 with zipfile.ZipFile(archive) as z:
  members={int(re.search(r'CIK(\d+)\.json$',n).group(1)):n for n in z.namelist() if re.search(r'(^|/)CIK\d+\.json$',n)}
  if not members:raise RuntimeError('No issuer files')
  if not set(results).issubset({str(cik) for cik in members}):raise RuntimeError('Invalid checkpoint')
  def publish(phase):
   entries=[{'cik':int(k),'symbols':symbols[int(k)],'name':v.get('name',''),'status':v['status'],'reason':v.get('reason')} for k,v in results.items() if int(k) in symbols]
   missing=[{'cik':cik,'symbols':ss,'name':'','status':'not_in_archive','reason':'代码目录中存在，本次财报包没有对应文件'} for cik,ss in symbols.items() if cik not in members];entries+=missing;entries.sort(key=lambda x:x['cik'])
   report={'version':'sec-bulk-v1','runId':run,'phase':phase,'startedAt':started,'updatedAt':now(),'retrievedAt':retrieved,'source':meta,'archiveSha256':digest,'counts':counts(results,len(members)),'listedDirectoryCompanies':len(symbols),'directoryMissingFromArchive':len(missing),'entries':entries,'failureReasons':dict(collections.Counter(v.get('reason','unknown') for v in results.values() if v['status']=='failed'))}
   save(out/'progress.json',report);save(cp,{'identity':identity,'startedAt':started,'retrievedAt':retrieved,'results':results});print(phase,report['counts'],flush=True)
  publish('processing');worker=subprocess.Popen(['node','scripts/normalize-financial-stream.mjs',retrieved],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
  try:
   for cik,name in members.items():
    if str(cik) in results:continue
    try:
     raw=z.read(name).decode('utf-8-sig').replace('\n','').replace('\r','');symbol=symbols.get(cik,[f'CIK{cik}'])[0]
     worker.stdin.write('{"raw":'+raw+',"cik":'+str(cik)+',"symbol":'+json.dumps(symbol)+'}\n');worker.stdin.flush();r=json.loads(worker.stdout.readline())
     if not r['ok']:raise ValueError(r['error'])
     item=r['item'];results[str(cik)]={'status':item['status'],'name':item['name']}
     if item['status']=='unsupported':results[str(cik)]['reason']='未找到支持的美元US-GAAP标准科目'
     if cik in symbols:save(records/f'{cik}.json',item)
    except (ValueError,KeyError,UnicodeError,zipfile.BadZipFile) as e:results[str(cik)]={'status':'failed','reason':str(e)[:160]}
    if len(results)%250==0:publish('processing')
   shards={i:{} for i in range(64)}
   for k,v in results.items():
    if int(k) in symbols and v['status']!='failed':shards[int(k)%64][k]=json.loads((records/f'{k}.json').read_text())
   for i,items in shards.items():save(out/f'companies-{i}.json',{'version':'sec-bulk-v1','runId':run,'companies':items})
   publish('completed_with_errors' if counts(results,len(members))['failed'] else 'completed')
  except BaseException:publish('interrupted');raise
  finally:worker.stdin.close();worker.wait(timeout=20)
def run():
 try:main()
 except Exception as exc:
  import sys
  args=sys.argv[1:];output=pathlib.Path(args[args.index('--output')+1] if '--output' in args else 'stock-ai/data/bulk')
  path=output/'progress.json'
  previous=json.loads(path.read_text()) if path.exists() else {'version':'sec-bulk-v1','phase':'blocked','counts':None,'entries':[]}
  previous.update(lastAttemptAt=now(),updateError='SEC 批量更新失败：'+type(exc).__name__+((' HTTP '+str(exc.code)) if hasattr(exc,'code') else ''))
  save(path,previous);raise
if __name__=='__main__':run()
