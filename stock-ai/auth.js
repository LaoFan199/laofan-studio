import { initializeAccount, accountSync } from './cloud-sync.js';
import { createClient } from '@supabase/supabase-js';
import { safeReturnTo } from './auth-paths.js';

const loginPage = document.body.dataset.page === 'login';
const status = document.getElementById('auth-status');
const form = document.getElementById('auth-form');
const appRoot = document.getElementById('app-root');
const base = new URL('./', location.href);
const callbackError = new URLSearchParams(location.hash.slice(1)).get('error_description');
const returnTo = safeReturnTo(new URLSearchParams(location.search).get('next'), base);
let client;
let leaving = false;
let loaded = false;
let activeUser;
function message(text) { status.textContent = text; }
function redirectToLogin() {
  leaving = true;
  accountSync?.stop();
  if (appRoot) { appRoot.hidden = true; appRoot.inert = true; }
  const target = new URL('login.html', base);
  target.searchParams.set('next', location.pathname + location.search + location.hash);
  location.replace(target.href);
}
function fail(error) {
  message(error?.code === 'invalid_credentials' ? '邮箱或密码不正确，请重试。' :
    error?.code === 'email_not_confirmed' ? '请先点击邮箱中的确认链接，再登录。' :
    error?.message || '暂时无法连接登录服务，请检查网络后重试。');
}
async function verify() {
  const { data: { session }, error } = await client.auth.getSession();
  if (error) throw error;
  if (!session) return null;
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  return user;
}
async function start() {
  const { default: config } = await import('./auth-config.js');
  if (!config.url || !config.key?.startsWith('sb_publishable_')) throw new Error('登录配置缺失，请联系网站管理员。');
  client = createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
  client.auth.onAuthStateChange((event, session) => {
    // Keep this callback synchronous to avoid the SDK auth lock.
    if (!loginPage && (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session))) redirectToLogin();
    if (!loginPage && loaded && session?.user.id && session.user.id !== activeUser) location.reload();
    if (loginPage && event === 'SIGNED_IN') setTimeout(() => checkLogin(), 0);
  });
  if (loginPage) {
    form.hidden = false;
    message('');
    await checkLogin();
    if (callbackError) message('邮箱确认链接已失效或无法使用，请重新注册或联系管理员。');
    return;
  }
  const user = await verify();
  if (!user) return redirectToLogin();
  if (leaving) return;
  activeUser = user.id;
  document.getElementById('auth-email').textContent = user.email || '已登录';
  document.getElementById('logout-button').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try {
      accountSync?.prepareLogout();
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      redirectToLogin();
    } catch (error) { fail(error); event.target.disabled = false; }
  });
  await initializeAccount(client, user.id);
  await import('./app.js?v=20260915-1');
  if (leaving) return;
  loaded = true;
  appRoot.hidden = false;
  appRoot.inert = false;
  message('');
}
async function checkLogin() {
  try { if (await verify()) location.replace(returnTo); }
  catch (error) { fail(error); }
}
if (form) {
  let signup = false;
  const toggle = document.getElementById('auth-toggle');
  const submit = document.getElementById('auth-submit');
  const password = document.getElementById('password');
  const confirm = document.getElementById('confirm-password');
  toggle.addEventListener('click', () => {
    signup = !signup;
    document.getElementById('auth-title').textContent = signup ? '创建账户' : '登录 LaoFan AI';
    submit.textContent = signup ? '注册' : '登录';
    toggle.textContent = signup ? '已有账户？返回登录' : '还没有账户？注册';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    password.minLength = signup ? 8 : 1;
    confirm.required = signup;
    document.getElementById('confirm-field').hidden = !signup;
    message('');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!client) return message('登录服务尚未准备好，请刷新后重试。');
    if (signup && password.value !== confirm.value) return message('两次输入的密码不一致。');
    submit.disabled = toggle.disabled = true;
    message(signup ? '正在注册…' : '正在登录…');
    const credentials = { email: document.getElementById('email').value.trim(), password: password.value };
    try {
      const { data, error } = signup ? await client.auth.signUp({ ...credentials, options: { emailRedirectTo: new URL('login.html', base).href } }) : await client.auth.signInWithPassword(credentials);
      if (error) throw error;
      password.value = confirm.value = '';
      if (data.session) await checkLogin();
      else message('请查收确认邮件，点击邮件中的链接后再登录。如果已注册，可直接返回登录。');
    } catch (error) { fail(error); }
    finally { submit.disabled = toggle.disabled = false; }
  });
}
// A restored browser-history page must revalidate before exposing the app.
window.addEventListener('pagehide', () => { if (appRoot) appRoot.hidden = true; });
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
start().catch(error => {
  if (!loginPage && error?.status >= 400 && error.status < 500) redirectToLogin();
  else { fail(error); document.getElementById('auth-retry').hidden = false; }
});
