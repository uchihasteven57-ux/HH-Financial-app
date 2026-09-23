(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const money = value => `${Math.round(Number(value) || 0).toLocaleString()} MMK`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  function state() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      value.transactions = Array.isArray(value.transactions) ? value.transactions : [];
      value.categories = Array.isArray(value.categories) ? value.categories : [];
      value.budgets = Array.isArray(value.budgets) ? value.budgets : [];
      value.goals = Array.isArray(value.goals) ? value.goals : [];
      value.loans = Array.isArray(value.loans) ? value.loans : [];
      value.settings = value.settings || {};
      return value;
    } catch (_) {
      return { transactions: [], categories: [], budgets: [], goals: [], loans: [], settings: {} };
    }
  }

  function save(value) {
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch (_) {}
  }

  async function sync(action, payload) {
    const current = state();
    const url = String(current.settings.syncUrl || '').trim();
    if (!url) throw Error('Add the Apps Script /exec URL first.');

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, payload || {}))
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw Error(result.error || `Sync failed (${response.status})`);
    return result.data || result;
  }

  async function pull() {
    try {
      const data = await sync('getAll');
      if (!data || !Array.isArray(data.transactions)) throw Error('Invalid response from Apps Script.');
      const current = state();
      current.transactions = data.transactions;
      if (Array.isArray(data.categories) && data.categories.length) current.categories = data.categories;
      current.budgets = Array.isArray(data.budgets) ? data.budgets : [];
      current.goals = Array.isArray(data.goals) ? data.goals : [];
      current.loans = Array.isArray(data.loans) ? data.loans : [];
      current.settings.syncRevision = data.revision || current.settings.syncRevision || '';
      current.settings.lastSynced = new Date().toISOString();
      save(current);
      location.reload();
    } catch (error) {
      if (typeof window.__moneyflowToast === 'function') window.__moneyflowToast(error.message);
      else alert(error.message);
    }
  }

  async function push() {
    try {
      const current = state();
      const data = await sync('replaceAll', {
        transactions: current.transactions,
        categories: current.categories,
        budgets: current.budgets,
        goals: current.goals,
        loans: current.loans
      });
      current.settings.syncRevision = data.revision || current.settings.syncRevision || '';
      current.settings.lastSynced = new Date().toISOString();
      save(current);
      if (typeof window.__moneyflowToast === 'function') window.__moneyflowToast('Synced to Google Sheets');
      else alert('Synced to Google Sheets');
    } catch (error) {
      if (typeof window.__moneyflowToast === 'function') window.__moneyflowToast(error.message);
      else alert(error.message);
    }
  }

  async function test() {
    try {
      await sync('status');
      if (typeof window.__moneyflowToast === 'function') window.__moneyflowToast('Apps Script connection is working');
      else alert('Apps Script connection is working');
    } catch (error) {
      if (typeof window.__moneyflowToast === 'function') window.__moneyflowToast(error.message);
      else alert(error.message);
    }
  }

  function renderLoanBI() {
    const host = $('loanBI');
    if (!host) return;
    const current = state();
    const month = current.reportMonth || new Date().toISOString().slice(0, 7);
    const rows = current.transactions.filter(tx => String(tx.date || '').slice(0, 7) === month);
    const received = rows.filter(tx => tx.type === 'income' && tx.loanId).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const payback = rows.filter(tx => tx.type === 'expense' && tx.loanId).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const outstanding = current.loans.reduce((sum, loan) => sum + Math.max(0, Number(loan.remaining || 0)), 0);
    host.innerHTML = `<div class="loan-bi-grid"><div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div><div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div><div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div></div><div class="loan-bi-list">${current.loans.length ? current.loans.map(loan => `<div class="loan-bi-row"><span>${esc(loan.name || 'Loan')}<small>Principal ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`).join('') : '<div class="empty">No loan records yet</div>'}</div>`;
  }

  // Capture sync controls before app.js's old JSON request handler runs.
  document.addEventListener('click', event => {
    const button = event.target.closest('#pull,#push,#test,[data-sync="pull"],[data-sync="push"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.id === 'pull' || button.dataset.sync === 'pull') pull();
    else if (button.id === 'test') test();
    else push();
  }, true);

  window.addEventListener('storage', renderLoanBI);
  document.addEventListener('submit', () => setTimeout(renderLoanBI, 0));
  document.addEventListener('change', event => { if (event.target.id === 'month' || event.target.id === 'syncUrl') setTimeout(renderLoanBI, 0); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderLoanBI, { once: true });
  else renderLoanBI();
})();
