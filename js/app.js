(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const today = new Date().toISOString().slice(0, 10);

  const defaults = [
    ['Food & Drinks', 'expense'], ['Transportation', 'expense'], ['Family', 'expense'],
    ['Housing', 'expense'], ['Utilities', 'expense'], ['Shopping', 'expense'],
    ['Health', 'expense'], ['Education', 'expense'], ['Salary', 'income'], ['Bonus', 'income']
  ];

  const fallback = {
    transactions: [], categories: defaults.map(([name, type]) => ({ name, type })),
    budgets: [], goals: [], loans: [],
    settings: { theme: 'light', syncUrl: '', syncRevision: '', lastSynced: '' },
    reportMonth: today.slice(0, 7)
  };

  let state = load();
  let syncing = false;
  state.settings = Object.assign({}, fallback.settings, state.settings || {});
  ['budgets', 'goals', 'loans', 'transactions'].forEach(key => {
    if (!Array.isArray(state[key])) state[key] = [];
  });
  state.categories = Array.isArray(state.categories) && state.categories.length ? state.categories : fallback.categories;
  state.currentType = state.currentType || 'expense';

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
      const base = Object.assign({}, fallback, raw);
      base.categories = Array.isArray(base.categories) && base.categories.length ? base.categories : fallback.categories;
      base.budgets = Array.isArray(base.budgets) ? base.budgets : [];
      base.goals = Array.isArray(base.goals) ? base.goals : [];
      base.loans = Array.isArray(base.loans) ? base.loans : [];
      base.transactions = Array.isArray(base.transactions) ? base.transactions.map(tx => {
        const item = Object.assign({}, tx);
        if (item.type === 'loan') { item.type = 'income'; item.category = item.category || 'Loan'; }
        return item;
      }) : [];
      return base;
    } catch (_) { return JSON.parse(JSON.stringify(fallback)); }
  }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} }
  function uid(prefix) { return `${prefix || 'id'}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function money(value) { return `${Math.round(Number(value) || 0).toLocaleString()} MMK`; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function toast(message) { const el = $('toast'); if (!el) return; el.textContent = message; el.classList.add('on'); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('on'), 2200); }
  function month() { return state.reportMonth || today.slice(0, 7); }
  function items() { return state.transactions.filter(tx => String(tx.date || '').slice(0, 7) === month()); }
  function totals(list) { return list.reduce((result, tx) => { const n = Number(tx.amount) || 0; if (tx.type === 'income') result.income += n; else if (tx.type === 'expense') result.expense += n; else if (tx.type === 'credit') result.credit += n; return result; }, { income: 0, expense: 0, credit: 0 }); }
  function show(id) { document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === id)); document.querySelectorAll('nav [data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === id)); }
  function populateCategories() { const select = $('category'); if (!select) return; const type = state.currentType === 'payback' ? 'expense' : state.currentType; const list = state.currentType === 'loan' ? [{ name: 'Loan' }] : state.categories.filter(category => category.type === type); select.innerHTML = list.length ? list.map(category => `<option value="${esc(category.name)}">${esc(category.name)}</option>`).join('') : '<option value="General">General</option>'; }
  function setType(type) { state.currentType = type; const titles = { expense:'Add Expense', income:'Add Income', loan:'Add Loan', payback:'Add Loan Payback', credit:'Add Credit Payment' }; if ($('formTitle')) $('formTitle').textContent = titles[type] || 'Add Entry'; if ($('amount')) $('amount').value = ''; if ($('note')) $('note').value = ''; if ($('loanSelect')) $('loanSelect').disabled = type !== 'payback'; if ($('loanField')) $('loanField').style.display = type === 'payback' ? 'block' : 'none'; document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.add === type)); populateCategories(); }
  function renderLoanSelect() { const el = $('loanSelect'); if (!el) return; const active = state.loans.filter(loan => Number(loan.remaining) > 0); el.innerHTML = active.length ? active.map(loan => `<option value="${esc(loan.id)}">${esc(loan.name || 'Loan')} (${money(loan.remaining)})</option>`).join('') : '<option value="">No active loan</option>'; }
  function updateMonthOptions() { const el = $('month'); if (!el) return; const months = Array.from(new Set(state.transactions.map(tx => String(tx.date || '').slice(0, 7)).filter(Boolean))).sort(); el.innerHTML = months.length ? months.map(value => `<option value="${value}">${value}</option>`).join('') : '<option value="">Current month</option>'; }
  function greeting() { const hour = new Date().getHours(); const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Night'; if ($('greet')) $('greet').textContent = `GOOD ${part.toUpperCase()}`; if ($('greetTitle')) $('greetTitle').textContent = 'Welcome back 👋'; if ($('focusSummary')) $('focusSummary').textContent = money(state.transactions.reduce((sum, tx) => sum + (tx.type === 'income' ? Number(tx.amount) || 0 : 0), 0)); if ($('loanSummary')) $('loanSummary').textContent = money(state.loans.reduce((sum, loan) => sum + (Number(loan.remaining) || 0), 0)); }
  function budgetRows() { const spent = {}; items().filter(tx => tx.type === 'expense').forEach(tx => { const key = tx.category || 'General'; spent[key] = (spent[key] || 0) + Number(tx.amount || 0); }); return state.budgets.map(budget => { const amount = Number(budget.amount) || 0; const used = spent[budget.category] || 0; return { category: budget.category, amount, used, pct: amount ? Math.min(100, Math.round(used / amount * 100)) : 0 }; }).filter(row => row.amount > 0); }
  function renderBudgets() { const el = $('budgets'); if (!el) return; const rows = budgetRows(); el.innerHTML = rows.length ? rows.map(row => `<div class="budget-card"><div class="head"><b>${esc(row.category)}</b><strong>${money(row.used)}</strong></div><div class="bar"><i style="width:${row.pct}%"></i></div><small>${money(row.amount)} budget</small></div>`).join('') : '<div class="empty">No budgets yet</div>'; }
  function renderGoals() { const el = $('goals'); if (!el) return; el.innerHTML = state.goals.length ? state.goals.map(goal => { const pct = goal.target ? Math.min(100, Number(goal.saved || 0) / Number(goal.target) * 100) : 0; return `<div class="goal-card"><div class="head"><b>${esc(goal.name)}</b><strong>${money(goal.saved)}</strong></div><div class="bar"><i style="width:${pct}%"></i></div><small>${money(goal.target)} target</small></div>`; }).join('') : '<div class="empty">No goals yet</div>'; }
  function theme() { document.body.classList.toggle('dark', state.settings.theme === 'dark'); if ($('switch')) $('switch').classList.toggle('on', state.settings.theme === 'dark'); }
  function render() { greeting(); renderLoanSelect(); updateMonthOptions(); const list = items(); const totalsNow = totals(list); const net = totalsNow.income - totalsNow.expense - totalsNow.credit; [['income', totalsNow.income], ['expense', totalsNow.expense], ['credit', totalsNow.credit], ['remaining', net]].forEach(([id, value]) => { if ($(id)) $(id).textContent = money(value); }); if ($('txCount')) $('txCount').textContent = `Activity (${list.length})`; if ($('txList')) $('txList').innerHTML = list.slice().reverse().map(tx => `<div class="row"><span>${esc(tx.type.toUpperCase())} ${esc(tx.category || 'General')}</span><b>${tx.type === 'income' ? '+' : '-'}${money(tx.amount)}</b></div>`).join('') || '<div class="empty">No transactions</div>'; renderBudgets(); renderGoals(); if ($('cashflow')) $('cashflow').textContent = money(net); if ($('spent')) $('spent').textContent = money(totalsNow.expense); if ($('remaining')) $('remaining').textContent = money(net); theme(); }

  function injectPlanningUI() {
    if ($('planningStyles') || !$('settings')) return;
    const style = document.createElement('style'); style.id = 'planningStyles'; style.textContent = '.planning-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.budget-card,.goal-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px}.budget-card .head,.goal-card .head{display:flex;justify-content:space-between;align-items:center}.bar{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:8px 0}.bar i{display:block;height:100%;background:#60a5fa;border-radius:inherit}@media(max-width:760px){.planning-grid{grid-template-columns:1fr}}'; document.head.appendChild(style);
    const panel = document.createElement('div'); panel.className = 'panel'; panel.innerHTML = '<div class="head"><h2>Budgets &amp; Goals</h2></div><div class="planning-grid"><form id="budgetForm"><label>Budget category<select id="budgetCategory"></select></label><label>Monthly amount<input id="budgetAmount" inputmode="decimal" required></label><button type="submit">Save budget</button></form><form id="goalForm"><label>Goal name<input id="goalName" required></label><label>Target amount<input id="goalTarget" inputmode="decimal" required></label><label>Saved amount<input id="goalSaved" inputmode="decimal" value="0"></label><button type="submit">Save goal</button></form></div>'; $('settings').appendChild(panel);
  }

  async function api(action, payload) { if (!state.settings.syncUrl) throw Error('Add the Apps Script URL first.'); const response = await fetch(state.settings.syncUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.assign({ action }, payload || {})) }); const result = await response.json().catch(() => ({})); if (!result.ok) throw Error(result.error || 'Sync failed'); return result.data || result; }
  async function pushChanges() { if (syncing || !state.settings.syncUrl) return; syncing = true; try { const result = await api('replaceAll', { transactions:state.transactions, categories:state.categories, budgets:state.budgets, goals:state.goals, loans:state.loans }); state.settings.syncRevision = result.revision || state.settings.syncRevision; state.settings.lastSynced = new Date().toISOString(); save(); toast('Synced to Google Sheets'); } catch (error) { toast(error.message || 'Sync failed'); } finally { syncing = false; render(); } }
  async function pull() { if (syncing || !state.settings.syncUrl) return; syncing = true; try { const result = await api('getAll'); if (result && Array.isArray(result.transactions)) { state.transactions = result.transactions; state.categories = Array.isArray(result.categories) && result.categories.length ? result.categories : fallback.categories; state.budgets = Array.isArray(result.budgets) ? result.budgets : []; state.goals = Array.isArray(result.goals) ? result.goals : []; state.loans = Array.isArray(result.loans) ? result.loans : []; state.settings.syncRevision = result.revision || state.settings.syncRevision; state.settings.lastSynced = new Date().toISOString(); save(); bindUI(); toast('Pulled from Google Sheets'); } } catch (error) { toast(error.message || 'Pull failed'); } finally { syncing = false; render(); } }
  function bindUI() { if ($('syncUrl')) $('syncUrl').value = state.settings.syncUrl || ''; const select = $('budgetCategory'); if (select) { const categories = state.categories.filter(category => category.type === 'expense'); select.innerHTML = categories.length ? categories.map(category => `<option value="${esc(category.name)}">${esc(category.name)}</option>`).join('') : '<option value="General">General</option>'; } }

  document.addEventListener('click', event => { const page = event.target.closest('[data-page]'); if (page) return show(page.dataset.page); const add = event.target.closest('[data-add]'); if (add) { setType(add.dataset.add); show('add'); return; } const sync = event.target.closest('[data-sync]'); if (sync) { if (sync.dataset.sync === 'push') pushChanges(); if (sync.dataset.sync === 'pull') pull(); } });
  document.addEventListener('submit', event => {
    if (event.target.id === 'budgetForm') { event.preventDefault(); const category = $('budgetCategory').value; const amount = Number(String($('budgetAmount').value).replace(/,/g, '')); if (!category || amount <= 0) return toast('Enter a valid budget amount'); state.budgets = state.budgets.filter(budget => budget.category !== category); state.budgets.push({ category, amount }); save(); render(); event.target.reset(); toast('Budget saved'); return; }
    if (event.target.id === 'goalForm') { event.preventDefault(); const name = $('goalName').value.trim(); const target = Number(String($('goalTarget').value).replace(/,/g, '')); const saved = Number(String($('goalSaved').value || 0).replace(/,/g, '')); if (!name || target <= 0 || saved < 0) return toast('Enter a valid goal'); const existing = state.goals.find(goal => goal.name.toLowerCase() === name.toLowerCase()); if (existing) { existing.target = target; existing.saved = saved; } else state.goals.push({ name, target, saved }); save(); render(); event.target.reset(); toast('Goal saved'); return; }
    if (event.target.id !== 'form') return; event.preventDefault(); const amount = Number(String($('amount').value).replace(/,/g, '')); if (!amount || amount <= 0) return toast('Enter an amount greater than 0'); const type = state.currentType; const date = $('date') ? ($('date').value || today) : today; const note = $('note') ? $('note').value.trim() : ''; let loanId = $('loanSelect') ? $('loanSelect').value : ''; const tx = { id:uid('tx'), type, amount, date, category:$('category') ? $('category').value : 'General', note, loanId, createdAt:new Date().toISOString() }; if (type === 'loan') { tx.type = 'income'; tx.category = 'Loan'; tx.loanId = uid('loan'); state.loans.push({ id:tx.loanId, name:note || 'Loan', principal:amount, remaining:amount, date, note, createdAt:tx.createdAt }); } else if (type === 'payback') { if (!loanId) return toast('Select a loan to pay back'); tx.type = 'expense'; tx.category = 'Loan Repayment'; const loan = state.loans.find(item => String(item.id) === String(loanId)); if (!loan) return toast('Selected loan was not found'); if (amount > Number(loan.remaining || 0)) return toast('Payback cannot exceed remaining loan'); loan.remaining = Math.max(0, Number(loan.remaining || 0) - amount); } state.transactions.push(tx); save(); render(); toast(type === 'loan' ? 'Loan saved' : type === 'payback' ? 'Loan payback saved' : 'Saved'); event.target.reset(); if ($('date')) $('date').value = today; if ($('loanSelect')) $('loanSelect').disabled = true;
  });

  ['theme', 'switch'].forEach(id => { const el = $(id); if (el) el.addEventListener('click', () => { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; save(); theme(); }); });
  document.addEventListener('change', event => { if (event.target && event.target.id === 'syncUrl') { state.settings.syncUrl = event.target.value.trim(); save(); } });

  injectPlanningUI(); bindUI(); if ($('date')) $('date').value = today; setType(state.currentType); render(); show('home');
})();
