export const emptyAccount = () => ({ cash: 1000, realized: 0, positions: {}, history: [], snapshots: [], benchmark: null });
export function hasAccountData(state) { return !!state && (state.history?.length > 0 || Object.keys(state.positions || {}).length > 0 || state.cash !== 1000); }
export function validAccount(state) { return !!state && Number.isFinite(state.cash) && state.cash >= 0 && Number.isFinite(state.realized) && state.positions && typeof state.positions === 'object' && !Array.isArray(state.positions) && Array.isArray(state.history); }
export class AccountSync {
  constructor({ client, userId, storage, notify, reload }) {
    Object.assign(this, { client, userId, storage, notify, reload });
    this.key = `laofan-cloud-account:${userId}`;
    this.pending = null; this.busy = false; this.blocked = false;
  }
  async read() {
    const { data, error } = await this.client.from('paper_accounts').select('*').eq('user_id', this.userId).maybeSingle();
    if (error) throw error;
    return data;
  }
  async init() {
    const owner = this.storage.getItem('laofan-legacy-owner');
    this.legacy = owner && owner !== this.userId ? null : JSON.parse(this.storage.getItem('laofan-paper-account') || 'null');
    let row = await this.read();
    if (!row) {
      const state = validAccount(this.legacy) ? this.legacy : emptyAccount();
      const { data, error } = await this.client.from('paper_accounts').insert({ user_id: this.userId, state, settings: { momentumAlerts: this.storage.getItem('laofan-momentum-alerts') === 'enabled' } }).select().single();
      if (error?.code === '23505') row = await this.read();
      else if (error) throw error;
      else row = data;
    }
    if (!validAccount(row?.state)) throw new Error('云端账户格式异常，已停止加载以保护记录。');
    // Never discard an unsent local snapshot after a reload/offline interruption.
    const pending = this.storage.getItem(this.key + ':pending');
    if (this.legacy) this.storage.setItem('laofan-legacy-owner', this.userId);
    this.row = row;
    this.initial = structuredClone(row.state);
    this.settings = structuredClone(row.settings || {});
    this.last = JSON.stringify({ state: row.state, settings: this.settings });
    this.storage.setItem(this.key, JSON.stringify(row));
    if (pending) {
      this.storage.setItem(this.key + ':backup:' + Date.now(), pending);
      this.notify('发现尚未同步的本机备份；当前显示云端账户，可下载备份核对。', 'backup');
    } else this.notify('云端账户已同步', 'ok');
    return this.initial;
  }
  save(state) {
    if (this.blocked) return;
    if (!validAccount(state)) { this.blocked = true; this.notify('账户数据异常，已暂停操作。', 'error'); return; }
    const snapshot = { state: structuredClone(state), settings: structuredClone(this.settings) };
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.last) return;
    this.pending = snapshot;
    this.storage.setItem(this.key + ':pending', serialized);
    this.notify('正在同步…', 'saving');
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 1000);
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.busy || this.blocked || !this.pending) return !this.pending;
    this.busy = true;
    const snapshot = this.pending;
    try {
      const { data, error } = await this.client.from('paper_accounts').update({ ...snapshot, revision: this.row.revision + 1, updated_at: new Date().toISOString() }).eq('user_id', this.userId).eq('revision', this.row.revision).select().maybeSingle();
      if (error) throw error;
      if (!data) {
        this.blocked = true;
        this.storage.setItem(this.key + ':backup:' + Date.now(), JSON.stringify(this.pending));
        this.notify('另一台设备已更新账户。本机修改已备份，请下载备份后刷新核对，避免覆盖。', 'conflict');
        return false;
      }
      this.row = data;
      this.last = JSON.stringify(snapshot);
      this.storage.setItem(this.key, JSON.stringify(data));
      if (this.pending === snapshot) { this.pending = null; this.storage.removeItem(this.key + ':pending'); this.notify('云端账户已同步', 'ok'); }
    } catch { this.blocked = true; this.notify('同步失败，本机修改已备份。请恢复网络后刷新核对；已暂停交易。', 'error'); return false; }
    finally { this.busy = false; }
    if (this.pending) return this.flush();
    return true;
  }
  async poll() {
    if (this.busy || this.pending || this.blocked) return;
    try { const row = await this.read(); if (row && row.revision !== this.row.revision) this.reload(); }
    catch { this.notify('暂时无法检查云端更新', 'offline'); }
  }
  stop() { this.blocked = true; clearTimeout(this.timer); clearInterval(this.pollTimer); }
}
export let accountSync;
export async function initializeAccount(client, userId) {
  const status = document.getElementById('sync-status');
  accountSync = new AccountSync({ client, userId, storage: localStorage, reload: () => location.reload(), notify: (text, kind) => {
    status.textContent = text;
    if (['conflict', 'error'].includes(kind)) {
      document.querySelector('#app-root main').inert = true;
      document.getElementById('reset-button').disabled = true;
      document.querySelectorAll('dialog').forEach(dialog => { if (dialog.open) dialog.close(); dialog.inert = true; });
      document.getElementById('sync-reload').hidden = false;
    }
    if (['conflict','error','backup'].includes(kind)) document.getElementById('sync-backup').hidden = false;
  } });
  await accountSync.init();
  document.getElementById('sync-backup').onclick = () => {
    const backup = localStorage.getItem(accountSync.key + ':pending') || Object.keys(localStorage).filter(k => k.startsWith(accountSync.key + ':backup:')).sort().map(k => localStorage.getItem(k)).pop();
    const blob = new Blob([backup || JSON.stringify(accountSync.row)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'laofan-account-backup.json'; a.click(); URL.revokeObjectURL(url);
  };
  const legacy = document.getElementById('sync-import');
  legacy.hidden = !hasAccountData(accountSync.legacy);
  legacy.onclick = async () => {
    if (!confirm('把此设备升级前的模拟账户导入云端？当前云端账户会先保存为本机备份，其他设备随后会读取导入的账户。')) return;
    if (accountSync.pending || accountSync.busy || accountSync.blocked) { status.textContent = '请等待同步完成或刷新后再导入。'; return; }
    localStorage.setItem(accountSync.key + ':backup:' + Date.now(), JSON.stringify(accountSync.row));
    accountSync.save(accountSync.legacy);
    if (await accountSync.flush()) location.reload();
  };
  accountSync.pollTimer = setInterval(() => accountSync.poll(), 15000);
  window.addEventListener('beforeunload', event => { if (accountSync.pending) { event.preventDefault(); event.returnValue = ''; } });
}
