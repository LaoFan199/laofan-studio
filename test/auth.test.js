import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { safeReturnTo } from '../stock-ai/auth-paths.js';

const base = new URL('https://example.com/laofan-studio/stock-ai/');
test('auth return path accepts app deep links and rejects open redirects and login loops', () => {
  for (const value of ['https://evil.test/', '//evil.test/', 'javascript:alert(1)', '../', 'login.html', '/stock-ai/', '/laofan-studio/stock-ai/../login.html']) assert.equal(safeReturnTo(value, base), base.href);
  assert.equal(safeReturnTo('index.html?view=watch#core-title', base), base.href + 'index.html?view=watch#core-title');
});

// Execute the actual browser controller with an isolated DOM and Auth service.
// These are controller tests, not claims of live Supabase integration success.
const source = (await readFile(new URL('../stock-ai/auth.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace("await import('./auth-config.js')", 'await Promise.resolve({ default: fixtureConfig })')
  .replace(/await import\('\.\/app\.js(?:\?[^']*)?'\)/, 'await loadApp()');
async function setup({ login = false, session = null, userError = null, signoutError = null, signupSession = null, badConfig = false, sync = undefined } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: ['auth-form', 'app-root', 'auth-retry'].includes(id), inert: true, textContent: '', value: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
    return elements.get(id);
  };
  let onAuth; let imports = 0; let reloads = 0; const redirects = []; const calls = [];
  const windowEvents = {};
  const auth = {
    onAuthStateChange(fn) { onAuth = fn; },
    async getSession() { return { data: { session }, error: null }; },
    async getUser() { return { data: { user: userError ? null : session?.user }, error: userError }; },
    async signOut(options) { calls.push(['signOut', options]); if (!signoutError) { session = null; onAuth('SIGNED_OUT', null); } return { error: signoutError }; },
    async signUp(options) { calls.push(['signUp', options]); session = signupSession; return { data: { session }, error: null }; },
    async signInWithPassword(options) { calls.push(['signIn', options]); session = { user: { id: 'one', email: options.email } }; return { data: { session }, error: null }; }
  };
  const location = { href: base.href + (login ? 'login.html?next=index.html%23core-title' : 'index.html#core-title'), pathname: base.pathname + 'index.html', search: login ? '?next=index.html%23core-title' : '', hash: '#core-title', replace(url) { redirects.push(url); }, reload() { reloads++; } };
  vm.runInNewContext(source, { URL, URLSearchParams, setTimeout, safeReturnTo, location,
    fixtureConfig: { url: 'https://project.supabase.co', key: badConfig ? 'secret' : 'sb_publishable_test' },
    initializeAccount: async () => {}, accountSync: sync, createClient: () => ({ auth }), loadApp: async () => { imports++; },
    document: { body: { dataset: { page: login ? 'login' : '' } }, getElementById: id => id === 'auth-form' && !login ? null : id === 'app-root' && login ? null : element(id) },
    window: { addEventListener(name, fn) { windowEvents[name] = fn; } }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { element, redirects, calls, imports: () => imports, reloads: () => reloads, windowEvents, event: (name, value) => onAuth(name, value) };
}
const session = { user: { id: 'one', email: 'test@example.com' } };
test('logout still calls Supabase when sync is blocked after a conflict', async () => {
  let backedUp=false;
  const c=await setup({session,sync:{blocked:true,prepareLogout(){backedUp=true;},stop(){}}});
  await c.element('logout-button').listeners.click({target:c.element('logout-button')});
  assert.equal(backedUp,true);assert.equal(c.calls[0][0],'signOut');assert.match(c.redirects[0],/login.html/);
});
test('unauthenticated app remains hidden and never initializes trading', async () => {
  const c = await setup(); assert.equal(c.imports(), 0); assert.equal(c.element('app-root').hidden, true);
  assert.match(c.redirects[0], /login.html\?next=/);
});
test('verified session loads existing application; logout hides it and redirects', async () => {
  const c = await setup({ session }); assert.equal(c.imports(), 1); assert.equal(c.element('app-root').hidden, false);
  await c.element('logout-button').listeners.click({ target: c.element('logout-button') });
  assert.equal(c.element('app-root').hidden, true); assert.match(c.redirects[0], /login.html/);
  assert.deepEqual(c.calls[0][1].scope, 'local');
});
test('forged or revoked saved session cannot load app', async () => {
  const c = await setup({ session, userError: { status: 401, message: 'Invalid JWT' } });
  assert.equal(c.imports(), 0); assert.match(c.redirects[0], /login.html/);
});
test('network verification failure fails closed and offers retry', async () => {
  const c = await setup({ session, userError: { message: 'Network unavailable' } });
  assert.equal(c.imports(), 0); assert.equal(c.element('auth-retry').hidden, false); assert.equal(c.redirects.length, 0);
});
test('logout failure stays visible and allows retry', async () => {
  const c = await setup({ session, signoutError: { message: 'Network unavailable' } });
  await c.element('logout-button').listeners.click({ target: c.element('logout-button') });
  assert.equal(c.redirects.length, 0); assert.equal(c.element('logout-button').disabled, false);
});
test('cross-tab signout hides app and account switch reloads', async () => {
  const c = await setup({ session }); c.event('SIGNED_IN', { user: { id: 'two' } }); assert.equal(c.reloads(), 1);
  c.event('SIGNED_OUT', null); assert.equal(c.element('app-root').hidden, true); assert.match(c.redirects[0], /login.html/);
});
test('restored browser history reloads before revealing the app', async () => {
  const c = await setup({ session }); c.windowEvents.pagehide(); assert.equal(c.element('app-root').hidden, true);
  c.windowEvents.pageshow({ persisted: true }); assert.equal(c.reloads(), 1);
});
test('sign-up checks matching passwords and shows email confirmation instead of app', async () => {
  const c = await setup({ login: true }); c.element('auth-toggle').listeners.click();
  c.element('email').value = 'test@example.com'; c.element('password').value = 'testing-password'; c.element('confirm-password').value = 'different';
  await c.element('auth-form').listeners.submit({ preventDefault() {} }); assert.equal(c.calls.length, 0);
  c.element('confirm-password').value = 'testing-password';
  await c.element('auth-form').listeners.submit({ preventDefault() {} });
  assert.equal(c.calls[0][0], 'signUp'); assert.match(c.element('auth-status').textContent, /确认邮件/); assert.equal(c.redirects.length, 0);
  assert.equal(c.element('password').value, '');
});
test('password sign-in verifies session and returns to protected deep link', async () => {
  const c = await setup({ login: true }); c.element('email').value = 'test@example.com'; c.element('password').value = 'testing-password';
  await c.element('auth-form').listeners.submit({ preventDefault() {} });
  assert.equal(c.calls[0][0], 'signIn'); assert.equal(c.redirects[0], base.href + 'index.html#core-title');
});
test('missing publishable configuration never loads app', async () => {
  const c = await setup({ session, badConfig: true }); assert.equal(c.imports(), 0); assert.equal(c.element('auth-retry').hidden, false);
});
