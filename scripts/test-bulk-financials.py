import importlib.util,json,pathlib,subprocess,tempfile,zipfile
s=importlib.util.spec_from_file_location('bulk','scripts/bulk-financials.py');b=importlib.util.module_from_spec(s);s.loader.exec_module(b)
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp);z=p/'fixture.zip';out=p/'out'
 raw={'cik':1,'entityName':'Fixture','facts':{'us-gaap':{'Revenues':{'units':{'USD':[{'start':'2024-01-01','end':'2024-12-31','filed':'2025-02-01','val':100,'accn':'0000000001-25-000001','form':'10-K'}]}}}}}
 with zipfile.ZipFile(z,'w') as f:
  f.writestr('CIK0000000001.json',json.dumps(raw));f.writestr('CIK0000000002.json',json.dumps({'cik':2,'entityName':'Unsupported','facts':{}}));f.writestr('CIK0000000003.json',json.dumps({'cik':99,'entityName':'Mismatch'}))
 b.save(p/'ticker-map.json',{'0':{'ticker':'TEST','cik_str':1},'1':{'ticker':'MISS','cik_str':4}})
 cmd=['python','scripts/bulk-financials.py','--cache',tmp,'--archive',str(z),'--resume','--output',str(out)]
 subprocess.run(cmd,check=True);d=json.loads((out/'progress.json').read_text());assert d['counts']=={'available':1,'unsupported':1,'failed':1,'total':3,'completed':3,'pending':0};assert d['directoryMissingFromArchive']==1
 original=(out/'companies-1.json').read_bytes();subprocess.run(cmd,check=True);assert (out/'companies-1.json').read_bytes()==original
 next(p.glob('records-*/1.json')).unlink();subprocess.run(cmd,check=True);assert (out/'companies-1.json').read_bytes()==original
print('ZIP identity, missing fields, counters, resume and missing-cache recovery passed')
