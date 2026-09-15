import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountSync, emptyAccount } from '../stock-ai/cloud-sync.js';
function setup(db, legacy = null) {
  const values = new Map(legacy ? [['laofan-paper-account', JSON.stringify(legacy)]] : []);
  const notices = []; let reloads = 0;
  const storage = { getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  const client = { from() {
    let mutation; const filters = {};
    const query = { select() { return this; }, eq(k,v) { filters[k] = v; return this; }, insert(v) { mutation = ['insert',v]; return this; }, update(v) { mutation = ['update',v]; return this; }, single() { return this.maybeSingle(); }, async maybeSingle() {
      if (db.fail) return { error: { message: 'offline' } };
      if (mutation?.[0] === 'insert') { if (db.row) return { error: { code: '23505' } }; db.row = { ...structuredClone(mutation[1]), revision: 1 }; }
      if (mutation?.[0] === 'update') { if (db.row.revision !== filters.revision) return { data: null }; db.row = { ...db.row, ...structuredClone(mutation[1]) }; }
      return { data: structuredClone(db.row), error: null };
    } }; return query;
  } };
  const sync = new AccountSync({client,userId:'test-user',storage,notify:(...n)=>notices.push(n),reload:()=>reloads++});
  return {sync,values,notices,reloads:()=>reloads};
}
test('legacy portfolio migrates only into an absent cloud account and remains locally backed up',async()=>{
  const old={...emptyAccount(),cash:900,positions:{KO:{quantity:1,avgPrice:100}},history:[{type:'买入',symbol:'KO'}]};
  const db={row:null};const c=setup(db,old);await c.sync.init();assert.deepEqual(db.row.state,old);assert.ok(c.values.has('laofan-paper-account'));
});
test('second device reads existing cloud state rather than overwriting with empty local state',async()=>{
  const db={row:{state:{...emptyAccount(),cash:850},settings:{momentumAlerts:true},revision:4}};
  const c=setup(db,emptyAccount());assert.equal((await c.sync.init()).cash,850);assert.equal(c.sync.settings.momentumAlerts,true);assert.equal(db.row.revision,4);
});
test('two devices cannot silently overwrite each other; losing write is backed up',async()=>{
  const db={row:null};const a=setup(db),b=setup(db);await a.sync.init();await b.sync.init();
  a.sync.save({...emptyAccount(),cash:950});await a.sync.flush();
  b.sync.save({...emptyAccount(),cash:800});assert.equal(await b.sync.flush(),false);
  assert.equal(db.row.state.cash,950);assert.equal(b.sync.blocked,true);assert.ok([...b.values.keys()].some(k=>k.includes(':backup:')));
});
test('network failure preserves pending trade; fresh device cannot silently erase it',async()=>{
  const db={row:null};const c=setup(db);await c.sync.init();db.fail=true;c.sync.save({...emptyAccount(),cash:900});await c.sync.flush();assert.equal(c.sync.blocked,true);assert.ok(c.values.has(c.sync.key+':pending'));
});
test('successful writes synchronize settings and next device polls for changes',async()=>{
  const db={row:null};const a=setup(db),b=setup(db);await a.sync.init();await b.sync.init();a.sync.settings.momentumAlerts=true;a.sync.save(emptyAccount());assert.equal(await a.sync.flush(),true);assert.equal(db.row.settings.momentumAlerts,true);await b.sync.poll();assert.equal(b.reloads(),1);assert.equal(a.values.has(a.sync.key+':pending'),false);
});
test('logout after conflict backs up unsent trades and clears the navigation blocker', async () => {
  const db = {row:null}; const a=setup(db), b=setup(db);
  await a.sync.init(); await b.sync.init();
  a.sync.save({...emptyAccount(),cash:950}); await a.sync.flush();
  b.sync.save({...emptyAccount(),cash:800}); await b.sync.flush();
  b.sync.prepareLogout();
  assert.equal(b.sync.pending,null);
  assert.equal(b.values.has(b.sync.key+':pending'),false);
  assert.ok([...b.values.entries()].some(([k,v])=>k.includes(':backup:') && JSON.parse(v).state.cash===800));
  assert.equal(db.row.state.cash,950);
});
test('quote-only remote updates do not interrupt a viewing device', async () => {
  const db={row:null};const a=setup(db),b=setup(db);await a.sync.init();await b.sync.init();
  a.sync.save({...emptyAccount(),broadScan:{processed:100}});await a.sync.flush();
  await b.sync.poll();assert.equal(b.reloads(),0);assert.equal(b.sync.row.revision,db.row.revision);
});
test('a trade can rebase over a quote-only update without overwriting other trades', async () => {
  const db={row:null};const a=setup(db),b=setup(db);await a.sync.init();await b.sync.init();
  a.sync.save({...emptyAccount(),broadScan:{processed:100}});await a.sync.flush();
  b.sync.save({...emptyAccount(),cash:900});assert.equal(await b.sync.flush(),true);assert.equal(db.row.state.cash,900);
});
test('stale quote-only viewer loads restored trades without getting locked in conflict', async () => {
  const db={row:null};const a=setup(db),b=setup(db);await a.sync.init();await b.sync.init();
  a.sync.save({...emptyAccount(),cash:636.12,history:[{symbol:'KO',type:'买入'}]});await a.sync.flush();
  b.sync.save({...emptyAccount(),broadScan:{processed:100}});await b.sync.flush();
  assert.equal(b.reloads(),1);assert.equal(b.sync.pending,null);assert.equal(db.row.state.cash,636.12);
});
