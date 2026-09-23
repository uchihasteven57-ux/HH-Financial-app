(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const defaults = [
    ['Food & Drinks', 'expense'], ['Transportation', 'expense'], ['Family', 'expense'],
    ['Housing', 'expense'], ['Utilities', 'expense'], ['Shopping', 'expense'],
    ['Health', 'expense'], ['Education', 'expense'], ['Salary', 'income'], ['Bonus', 'income']
  ];
  const fallback = {
    transactions: [], categories: defaults.map(([name, type]) => ({ name, type })),
    budgets: [], goals: [], loans: [], reportMonth: currentMonth,
    settings: { theme: 'light', syncUrl: '', syncRevision: '', lastSynced: '' }
  };

  let state = load();
  let syncing = false;
  normalizeState();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      return Object.assign({}, fallback, raw);
    } catch (_) {
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  function normalizeState() {
    state.settings = Object.assign({}, fallback.settings, state.settings || {});
    state.categories = Array.isArray(state.categories) && state.categories.length ? state.categories : fallback.categories.slice();
    ['transactions', 'budgets', 'goals', 'loans'].forEach(key => { if (!Array.isArray(state[key])) state[key] = []; });
    state.reportMonth = /^\d{4}-\d{2}$/.test(String(state.reportMonth || '')) ? state.reportMonth : currentMonth;
    state.currentType = state.currentType || 'expense';
    state.transactions = state.transactions.map(tx => {
      const item = Object.assign({}, tx);
      const category = String(item.category || '').toLowerCase();
      if (item.type === 'loan' || category === 'loan' || category === 'loan received') {
        item.type = 'income';
        item.category = 'Loan';
        item.loanId = item.loanId || uid('loan');
      }
      if (category === 'loan repayment' || category === 'loan payback') {
        item.type = 'expense';
        item.category = 'Loan Repayment';
      }
      return item;
    });
    rebuildMissingLoans();
    save();
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} }
  function uid(prefix) { return `${prefix || 'id'}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function money(value) { return `${Math.round(Number(value) || 0).toLocaleString()} MMK`; }
  function number(value) { return Number(String(value == null ? '' : value).replace(/,/g, '')) || 0; }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function toast(message) { const el = $('toast'); if (!el) return; el.textContent = message; el.classList.add('on'); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('on'), 2200); }
  function month() { return state.reportMonth || currentMonth; }
  function items() { return state.transactions.filter(tx => String(tx.date || '').slice(0, 7) === month()); }
  function cleanLoanName(tx) { return String(tx.note || 'Loan').trim() || 'Loan'; }

  function rebuildMissingLoans() {
    state.transactions.filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
      if (!state.loans.some(loan => String(loan.id) === String(tx.loanId))) {
        state.loans.push({ id: tx.loanId, name: cleanLoanName(tx), principal: number(tx.amount), remaining: number(tx.amount), date: tx.date || today, note: tx.note || '', createdAt: tx.createdAt || new Date().toISOString() });
      }
    });
  }

  function loanTransactions() { return state.transactions.filter(tx => tx.loanId); }
  function loanReceived(list) { return list.filter(tx => tx.type === 'income' && tx.loanId).reduce((sum, tx) => sum + number(tx.amount), 0); }
  function loanPaybacks(list) { return list.filter(tx => tx.type === 'expense' && tx.loanId).reduce((sum, tx) => sum + number(tx.amount), 0); }
  function outstanding() { return state.loans.reduce((sum, loan) => sum + Math.max(0, number(loan.remaining)), 0); }

  function totals(list) {
    return list.reduce((result, tx) => {
      const amount = number(tx.amount);
      if (tx.type === 'income') result.income += amount;
      else if (tx.type === 'expense') result.expense += amount;
      else if (tx.type === 'credit') result.credit += amount;
      return result;
    }, { income: 0, expense: 0, credit: 0 });
  }

  function show(id) {
    document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === id));
    document.querySelectorAll('nav [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === id));
  }

  function populateCategories() {
    const select = $('category');
    if (!select) return;
    const type = state.currentType === 'payback' ? 'expense' : state.currentType;
    const list = state.currentType === 'loan' ? [{ name: 'Loan' }] : state.categories.filter(category => category.type === type);
    select.innerHTML = list.length ? list.map(category => `<option value="${esc(category.name)}">${esc(category.name)}</option>`).join('') : '<option value="General">General</option>';
  }

  function renderLoanSelect() {
    const select = $('loanSelect');
    if (!select) return;
    const activeLoans = state.loans.filter(loan => number(loan.remaining) > 0);
    select.innerHTML = activeLoans.length ? activeLoans.map(loan => `<option value="${esc(loan.id)}">${esc(loan.name || 'Loan')} (${money(loan.remaining)})</option>`).join('') : '<option value="">No active loan</option>';
  }

  function setType(type) {
    state.currentType = type;
    const titles = { expense: 'Add Expense', income: 'Add Income', loan: 'Add Loan', payback: 'Add Loan Payback', credit: 'Add Credit Payment' };
    if ($('formTitle')) $('formTitle').textContent = titles[type] || 'Add Entry';
    if ($('amount')) $('amount').value = '';
    if ($('note')) $('note').value = '';
    if ($('loanSelect')) $('loanSelect').disabled = type !== 'payback';
    if ($('loanField')) $('loanField').hidden = type !== 'payback';
    document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.add === type || button.dataset.type === type));
    populateCategories();
    renderLoanSelect();
  }

  function updateMonthOptions() {
    const select = $('month');
    if (!select) return;
    const values = Array.from(new Set(state.transactions.map(tx => String(tx.date || '').slice(0, 7)).filter(Boolean)));
    if (!values.includes(month())) values.push(month());
    select.value = month();
  }

  function renderHome() {
    const list = items();
    const totalsNow = totals(list);
    const net = totalsNow.income - totalsNow.expense - totalsNow.credit;
    [['income', totalsNow.income], ['expense', totalsNow.expense], ['credit', totalsNow.credit], ['remaining', net]].forEach(([id, value]) => { if ($(id)) $(id).textContent = money(value); });
    if ($('loan')) $('loan').textContent = money(loanPaybacks(list));
    if ($('loanSummary')) $('loanSummary').textContent = money(outstanding());
    if ($('txCount')) $('txCount').textContent = `Activity (${list.length})`;
    if ($('remaining')) $('remaining').textContent = money(net);
    const recent = $('recent');
    if (recent) recent.innerHTML = list.slice().reverse().slice(0, 8).map(tx => `<div class="row"><span>${esc(tx.type.toUpperCase())} ${esc(tx.category || 'General')}</span><b class="${tx.type === 'income' ? 'up' : 'down'}">${tx.type === 'income' ? '+' : '-'}${money(tx.amount)}</b></div>`).join('') || '<div class="empty">No transactions</div>';
    const breakdown = $('breakdown');
    if (breakdown) breakdown.innerHTML = categoryRows(list).slice(0, 5).map(row => `<div class="row"><span>${esc(row.name)}</span><b>${money(row.amount)}</b></div>`).join('') || '<div class="empty">No expense data</div>';
  }

  function categoryRows(list) {
    const grouped = {};
    list.filter(tx => tx.type === 'expense' && !tx.loanId).forEach(tx => { const key = tx.category || 'General'; grouped[key] = (grouped[key] || 0) + number(tx.amount); });
    return Object.entries(grouped).sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount }));
  }

  function renderReports() {
    const list = items();
    const totalsNow = totals(list);
    const categories = categoryRows(list);
    const net = totalsNow.income - totalsNow.expense - totalsNow.credit;
    if ($('cashflow')) $('cashflow').textContent = money(net);
    if ($('spent')) $('spent').textContent = money(totalsNow.expense);
    if ($('remaining')) $('remaining').textContent = money(net);
    if ($('topSpend')) $('topSpend').textContent = categories[0] ? categories[0].name : '—';
    if ($('topAmt')) $('topAmt').textContent = categories[0] ? money(categories[0].amount) : '0 MMK';
    if ($('rhythm')) $('rhythm').textContent = String(list.length);
    if ($('reportList')) $('reportList').innerHTML = categories.length ? categories.slice(0, 5).map(row => `<li><span>${esc(row.name)}</span><b>${money(row.amount)}</b></li>`).join('') : '<li><span>No expense data</span><b>0 MMK</b></li>';
    renderMonthlyTrend();
    renderLoanBI();
  }

  function monthlyRows() {
    const grouped = {};
    state.transactions.forEach(tx => {
      const key = String(tx.date || '').slice(0, 7);
      if (!key) return;
      if (!grouped[key]) grouped[key] = { month: key, income: 0, expense: 0, credit: 0, loan: 0, payback: 0 };
      const amount = number(tx.amount);
      if (tx.type === 'income') { grouped[key].income += amount; if (tx.loanId) grouped[key].loan += amount; }
      if (tx.type === 'expense') { grouped[key].expense += amount; if (tx.loanId) grouped[key].payback += amount; }
      if (tx.type === 'credit') grouped[key].credit += amount;
    });
    return Object.values(grouped).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  }

  function renderMonthlyTrend() {
    const canvas = $('chart');
    const host = $('focusBI');
    const rows = monthlyRows();
    if (host) host.innerHTML = rows.length ? rows.map(row => `<div class="row"><span>${esc(row.month)}<small>Inflow ${money(row.income)} · Outflow ${money(row.expense + row.credit)}</small></span><b>${money(row.income - row.expense - row.credit)}</b></div>`).join('') : '<div class="empty">No monthly data yet</div>';
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth || 600;
    const height = canvas.height = 220;
    canvas.width = width;
    ctx.clearRect(0, 0, width, height);
    if (!rows.length) return;
    const max = Math.max(1, ...rows.flatMap(row => [row.income, row.expense + row.credit]));
    const step = width / Math.max(1, rows.length);
    rows.forEach((row, index) => {
      const x = step * index + step / 2;
      const incomeHeight = row.income / max * 150;
      const outHeight = (row.expense + row.credit) / max * 150;
      ctx.fillStyle = '#34d399'; ctx.fillRect(x - 18, 175 - incomeHeight, 14, incomeHeight);
      ctx.fillStyle = '#f97316'; ctx.fillRect(x + 4, 175 - outHeight, 14, outHeight);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted') || '#64748b'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(row.month, x, 198);
    });
  }

  function renderLoanBI() {
    const host = $('loanBI');
    if (!host) return;
    const list = items();
    const received = loanReceived(list);
    const payback = loanPaybacks(list);
    host.innerHTML = `<div class="loan-bi-grid"><div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div><div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div><div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding())}</strong></div></div><div class="loan-bi-list">${state.loans.length ? state.loans.map(loan => `<div class="loan-bi-row"><span>${esc(loan.name || 'Loan')}<small>Principal ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`).join('') : '<div class="empty">No loan records yet</div>'}</div>`;
  }

  function renderTransactions() {
    const body = $('rows');
    if (!body) return;
    body.innerHTML = state.transactions.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(tx => `<tr><td>${esc(tx.date || '')}</td><td>${esc(tx.category || 'General')}</td><td class="${tx.type === 'income' ? 'up' : 'down'}">${tx.type === 'income' ? '+' : '-'}${money(tx.amount)}</td><td><button type="button" data-delete="${esc(tx.id)}">×</button></td></tr>`).join('') || '<tr><td colspan="4">No transactions</td></tr>';
  }

  function renderCategories() {
    const host = $('cats');
    if (host) host.innerHTML = state.categories.map((category, index) => `<div class="row"><span>${esc(category.name)} <small>${esc(category.type)}</small></span><button type="button" data-delete-category="${index}">×</button></div>`).join('');
  }

  function bindUI() {
    if ($('syncUrl')) $('syncUrl').value = state.settings.syncUrl || '';
    if ($('month')) $('month').value = month();
    renderCategories();
  }

  function theme() { document.body.classList.toggle('dark', state.settings.theme === 'dark'); if ($('switch')) $('switch').classList.toggle('on', state.settings.theme === 'dark'); }

  async function api(action, payload) {
    if (!state.settings.syncUrl) throw Error('Add the Apps Script URL first.');
    const response = await fetch(state.settings.syncUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action }, payload || {})) });
    const result = await response.json().catch(() => ({}));
    if (!result.ok) throw Error(result.error || 'Sync failed');
    return result.data || result;
  }

  async function pull() {
    if (syncing) return; syncing = true;
    try { const data = await api('getAll'); if (data && Array.isArray(data.transactions)) { state.transactions = data.transactions; state.categories = Array.isArray(data.categories) && data.categories.length ? data.categories : fallback.categories.slice(); state.budgets = Array.isArray(data.budgets) ? data.budgets : []; state.goals = Array.isArray(data.goals) ? data.goals : []; state.loans = Array.isArray(data.loans) ? data.loans : []; rebuildMissingLoans(); state.settings.syncRevision = data.revision || state.settings.syncRevision; state.settings.lastSynced = new Date().toISOString(); save(); bindUI(); toast('Pulled from Google Sheets'); } } catch (error) { toast(error.message); } finally { syncing = false; render(); }
  }

  async function push() {
    if (syncing) return; syncing = true;
    try { const data = await api('replaceAll', { transactions: state.transactions, categories: state.categories, budgets: state.budgets, goals: state.goals, loans: state.loans }); state.settings.syncRevision = data.revision || state.settings.syncRevision; state.settings.lastSynced = new Date().toISOString(); save(); toast('Synced to Google Sheets'); } catch (error) { toast(error.message); } finally { syncing = false; render(); }
  }

  document.addEventListener('click', event => {
    const page = event.target.closest('[data-page]'); if (page) { show(page.dataset.page); return; }
    const add = event.target.closest('[data-add]'); if (add) { setType(add.dataset.add); show('add'); return; }
    const tab = event.target.closest('[data-type]'); if (tab) { setType(tab.dataset.type); show('add'); return; }
    const syncButton = event.target.closest('#pull,[data-sync="pull"]'); if (syncButton) { pull(); return; }
    if (event.target.closest('#push,[data-sync="push"]')) { push(); return; }
    const del = event.target.closest('[data-delete]'); if (del) { state.transactions = state.transactions.filter(tx => String(tx.id) !== String(del.dataset.delete)); save(); render(); return; }
    const delCategory = event.target.closest('[data-delete-category]'); if (delCategory) { state.categories.splice(Number(delCategory.dataset.deleteCategory), 1); save(); renderCategories(); populateCategories(); return; }
    if (event.target.id === 'clear') { if (confirm('Clear all transactions?')) { state.transactions = []; state.loans = []; save(); render(); } return; }
    if (event.target.id === 'theme' || event.target.id === 'switch') { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; save(); theme(); }
    if (event.target.id === 'addCat') { const name = ($('newCat')?.value || '').trim(); const type = $('newType')?.value || 'expense'; if (!name) return toast('Enter a category name'); state.categories.push({ name, type, createdAt: new Date().toISOString() }); $('newCat').value = ''; save(); renderCategories(); populateCategories(); toast('Category added'); }
    if (event.target.id === 'export') { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'moneyflow-backup.json'; link.click(); URL.revokeObjectURL(link.href); }
  });

  document.addEventListener('change', event => { if (event.target.id === 'month') { state.reportMonth = event.target.value || currentMonth; save(); render(); } if (event.target.id === 'syncUrl') { state.settings.syncUrl = event.target.value.trim(); save(); } });

  document.addEventListener('submit', event => {
    if (event.target.id !== 'form') return;
    event.preventDefault();
    const amount = number($('amount')?.value);
    if (amount <= 0) return toast('Enter an amount greater than 0');
    const type = state.currentType;
    const date = $('date')?.value || today;
    const note = ($('note')?.value || '').trim();
    const tx = { id: uid('tx'), type, amount, date, category: $('category')?.value || 'General', note, loanId: '', createdAt: new Date().toISOString() };

    if (type === 'loan') {
      const loanId = uid('loan');
      tx.type = 'income'; tx.category = 'Loan'; tx.loanId = loanId;
      state.loans.push({ id: loanId, name: note || 'Loan', principal: amount, remaining: amount, date, note, createdAt: tx.createdAt });
    } else if (type === 'payback') {
      const loanId = $('loanSelect')?.value || '';
      const loan = state.loans.find(item => String(item.id) === String(loanId));
      if (!loan) return toast('Select an active loan to repay');
      if (amount > number(loan.remaining)) return toast('Payback cannot exceed remaining loan');
      tx.type = 'expense'; tx.category = 'Loan Repayment'; tx.loanId = loanId;
      loan.remaining = Math.max(0, number(loan.remaining) - amount);
    } else if (type === 'credit') {
      tx.type = 'credit';
    } else {
      tx.type = type;
    }

    state.transactions.push(tx);
    save();
    event.target.reset();
    if ($('date')) $('date').value = today;
    render();
    toast(type === 'loan' ? 'Loan received and recorded as income' : type === 'payback' ? 'Loan payback recorded as expense' : 'Saved');
  });

  function render() {
    normalizeState();
    bindUI(); populateCategories(); renderLoanSelect(); updateMonthOptions(); renderHome(); renderReports(); renderTransactions(); theme();
  }

  if ($('date')) $('date').value = today;
  setType(state.currentType);
  render();
  show('home');
})();
