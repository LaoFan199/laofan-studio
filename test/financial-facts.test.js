import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFacts, snapshotState, FINANCIAL_VERSION } from '../stock-ai/financial-facts.js';
const fact = (extra={}) => ({start:'2024-01-01',end:'2024-12-31',filed:'2025-02-01',val:100,accn:'0000000001-25-000001',form:'10-K',...extra});
const raw = (values,tag='Revenues',unit='USD') => ({cik:1,entityName:'Fixture',facts:{'us-gaap':{[tag]:{units:{[unit]:values}}}}});
test('exclude future filings, select latest restatement and retain provenance',()=>{
 const result=normalizeFacts(raw([fact(),fact({val:120,filed:'2025-03-01'}),fact({val:999,filed:'2026-01-01'})]),'TEST','2025-06-01T00:00:00Z');
 assert.equal(result.series.revenue.annual.length,1); assert.equal(result.series.revenue.annual[0].value,120);
 assert.equal(result.series.revenue.annual[0].filed,'2025-03-01');
});
test('exclude YTD from quarters, never derive cash-flow quarters or zero-fill',()=>{
 const data=normalizeFacts(raw([fact({end:'2024-03-31'}),fact({end:'2024-06-30'}),fact()]),'TEST','2025-06-01T00:00:00Z');
 assert.equal(data.series.revenue.quarter.length,1); assert.equal(data.series.eps.annual.length,0);
 const flow=normalizeFacts(raw([fact({end:'2024-03-31'}),fact()],'NetCashProvidedByUsedInOperatingActivities'),'TEST','2025-06-01T00:00:00Z');
 assert.equal(flow.series.operatingCashFlow.quarter.length,0); assert.equal(flow.series.operatingCashFlow.annual.length,1);
});
test('unsupported currency, bad facts and same-day filing fail closed',()=>{
 assert.equal(normalizeFacts(raw([fact()],'Revenues','CAD'),'TEST','2025-06-01T00:00:00Z').status,'unsupported');
 assert.equal(normalizeFacts(raw([fact({val:null}),fact({filed:'2025-06-01'})]),'TEST','2025-06-01T12:00:00Z').status,'unsupported');
});
test('snapshot freshness and version are explicit',()=>{
 const d={version:FINANCIAL_VERSION,generatedAt:'2025-06-01T00:00:00Z',companies:[]};
 assert.equal(snapshotState(d,Date.parse('2025-06-02')),'available');
 assert.equal(snapshotState(d,Date.parse('2025-06-09')),'stale');
 assert.equal(snapshotState({...d,version:'bad'}),'invalid');
});

test('SEC zero-padded string CIK retains numeric identity; malformed cache rejected',()=>{
 const fixture=raw([fact()]); fixture.cik='0000000001';
 const normalized=normalizeFacts(fixture,'TEST','2025-06-01T00:00:00Z');
 assert.equal(normalized.cik,1);
 const d={version:FINANCIAL_VERSION,generatedAt:'2025-06-01T00:00:00Z',companies:[normalized]};
 assert.equal(snapshotState(d,Date.parse('2025-06-02')),'available');
 normalized.series.revenue.annual[0].value=null;
 assert.equal(snapshotState(d,Date.parse('2025-06-02')),'invalid');
});
