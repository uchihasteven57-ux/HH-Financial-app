(() => {
  'use strict';

  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const today = new Date().toISOString().slice(0, 10);

  const defaults = [
    ['Food & Drinks', 'expense'],
    ['Transportation', 'expense'],
    ['Family', 'expense'],
    ['Housing', 'expense'],
    ['Utilities', 'expense'],
    ['Shopping', 'expense'],
    ['Health', 'expense'],
    ['Education', 'expense'],
    ['Salary', 'income'],
    ['Bonus', 'income']
  ];

  const fallback = {
    transactions: [],
    categories: defaults.map(([name, type]) => ({ name, type })),
    budgets: [],
    goals: [],
    loans: [],
    settings: {
      theme: 'light',
      syncUrl: '',
      syncRevision: '',
      lastSynced: ''
    },
    reportMonth: today.slice(0, 7)
  };

  let state = load();
  let syncing = false;

  state.settings = Object.assign({}, fallback.settings, state.settings || {});
  state.budgets = Array.isArray(state.budgets) ? state.budgets : [];
  state.goals = Array.isArray(state.goals) ? state.goals : [];
  state.loans = Array.isArray(state.loans) ? state.loans : [];
  state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
  state.categories = Array.isArray(state.categories) && state.categories.length ? state.categories : fallback.categories;
  state.currentType = state.currentType || 'expense';

  function uid(prefix = 'id') {
    if (window.crypto && window.crypto.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

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
        if (item.type === 'loan') {
          item.type = 'income';
          item.category = item.category || 'Loan';
        }
        return item;
      }) : [];

      return base;
    } catch (error) {
      return fallback;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {}
  }

  function money(n) {
    return `${Math.round(Number(n) || 0).toLocaleString()} MMK`;
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function toast(m) {
    const e = $('toast');
    if (!e) return;
    e.textContent = m;
    e.classList.add('on');
    clearTimeout(e._timer);
    e._timer = setTimeout(() => e.classList.remove('on'), 2200);
  }

  function month() {
    return state.reportMonth || today.slice(0, 7);
  }

  function items() {
    return (state.transactions || []).filter(t => String(t.date || '').slice(0, 7) === month());
  }

  function totals(xs) {
    return xs.reduce((r, t) => {
      const n = Number(t.amount) || 0;
      if (t.type === 'income') r.income += n;
      else if (t.type === 'expense') r.expense += n;
      else if (t.type === 'credit') r.credit += n;
      return r;
    }, { income: 0, expense: 0, credit: 0 });
  }

  function renderLoanSelect() {
    const el = $('loanSelect');
    if (!el) return;

    const active = (state.loans || []).filter(l => Number(l.remaining) > 0);
    if (!active.length) {
      el.innerHTML = '<option value="">No active loan</option>';
      return;
    }

    el.innerHTML = active.map(l => `
      <option value="${esc(l.id)}">${esc(l.name || 'Loan')} (${money(l.remaining)})</option>
    `).join('');
  }

  function updateMonthOptions() {
    const el = $('month');
    if (!el) return;

    const months = Array.from(new Set((state.transactions || []).map(t => String(t.date || '').slice(0, 7)).filter(Boolean))).sort();
    if (!months.length) {
      el.innerHTML = '<option value="">Current month</option>';
      return;
    }

    el.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');
  }

  function greeting() {
    const h = new Date().getHours();
    const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';

    if ($('greet')) $('greet').textContent = `GOOD ${part.toUpperCase()}`;
    if ($('greetTitle')) $('greetTitle').textContent = 'Welcome back 👋';
    if ($('focusSummary')) $('focusSummary').textContent = money((state.transactions || []).reduce((sum, t) => sum + (t.type === 'income' ? Number(t.amount) || 0 : 0), 0));
    if ($('loanSummary')) $('loanSummary').textContent = money((state.loans || []).reduce((sum, l) => sum + (Number(l.remaining) || 0), 0));
  }

  function setType(type) {
    state.currentType = type;

    const titles = {
      expense: 'Add Expense',
      income: 'Add Income',
      loan: 'Add Loan',
      payback: 'Add Loan Payback',
      credit: 'Add Credit Payment'
    };

    if ($('formTitle')) $('formTitle').textContent = titles[type] || 'Add Entry';
    if ($('amount')) $('amount').value = '';
    if ($('note')) $('note').value = '';
    if ($('loanSelect')) $('loanSelect').disabled = type !== 'payback';
    if ($('loanField')) $('loanField').style.display = type === 'payback' ? 'block' : 'none';

    const tabButtons = document.querySelectorAll('.tab');
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.add === type));

    populateCategories();
  }

  function populateCategories() {
    const s = $('category');
    if (!s) return;

    const type = state.currentType === 'payback' ? 'expense' : state.currentType;

    let list = [];
    if (state.currentType === 'loan') {
      list = [{ name: 'Loan', type: 'income' }];
    } else {
      list = (state.categories || []).filter(c => c.type === type);
    }

    s.innerHTML = list.length
      ? list.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')
      : '<option value="General">General</option>';
  }

  function show(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
    document.querySelectorAll('nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  }

  function budgetRows() {
    const spent = {};
    items()
      .filter(t => t.type === 'expense')
      .forEach(t => {
        const key = t.category || 'General';
        spent[key] = (spent[key] || 0) + Number(t.amount || 0);
      });

    return (state.budgets || [])
      .map(b => {
        const target = Number(b.amount) || 0;
        const used = spent[b.category] || 0;
        const pct = target ? Math.min(100, Math.round((used / target) * 100)) : 0;
        return { category: b.category, amount: target, used, pct };
      })
      .filter(b => b.amount > 0);
  }

  function renderBudgets() {
    const rows = budgetRows();
    const html = rows.length
      ? rows.map(b => `
        <div class="budget-card ${b.pct >= 100 ? 'over' : b.pct >= 80 ? 'near' : ''}">
          <div class="head">
            <b>${esc(b.category)}</b>
            <strong>${money(b.used)}</strong>
          </div>
          <div class="bar">
            <i style="width:${Math.min(100, b.pct)}%"></i>
          </div>
          <small>${money(b.amount)} budget</small>
        </div>
      `).join('')
      : '<div class=\"empty\">No budgets yet</div>';

    const el = $('budgets');
    if (el) el.innerHTML = html;
  }

  function renderGoals() {
    const html = (state.goals || []).length
      ? (state.goals || []).map(g => {
          const pct = g.target ? Math.min(100, Number(g.saved || 0) / Number(g.target) * 100) : 0;
          return `
            <div class="goal-card">
              <div class="head">
                <b>${esc(g.name)}</b>
                <strong>${money(g.saved || 0)}</strong>
              </div>
              <div class="bar">
                <i style="width:${pct}%"></i>
              </div>
              <small>${money(g.target || 0)} target</small>
            </div>
          `;
        }).join('')
      : '<div class=\"empty\">No goals yet</div>';

    const el = $('goals');
    if (el) el.innerHTML = html;
  }

  function renderReports() {
    const xs = items();
    const t = totals(xs);
    const grouped = {};

    xs.filter(x => x.type === 'expense').forEach(x => {
      const key = x.category || 'General';
      grouped[key] = (grouped[key] || 0) + Number(x.amount || 0);
    });

    const top = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const el = $('reportList');

    if (el) {
      el.innerHTML = top.length
        ? top.map(([name, val]) => `<li><span>${esc(name)}</span><b>${money(val)}</b></li>`).join('')
        : '<li><span>No expense data</span><b>0 MMK</b></li>';
    }

    if ($('cashflow')) $('cashflow').textContent = money(t.income - t.expense - t.credit);
    if ($('spent')) $('spent').textContent = money(t.expense);
    if ($('remaining')) $('remaining').textContent = money(t.income - t.expense - t.credit);
  }

  function loanTrend() {
    const result = {};
    const txs = state.transactions || [];

    txs.forEach(tx => {
      if (!tx.loanId) return;
      const monthKey = String(tx.date || '').slice(0, 7);
      if (!monthKey) return;

      if (!result[monthKey]) result[monthKey] = { loan: 0, payback: 0 };

      if (tx.type === 'income') result[monthKey].loan += Number(tx.amount) || 0;
      if (tx.type === 'expense') result[monthKey].payback += Number(tx.amount) || 0;
    });

    return Object.keys(result).sort().slice(-6).map(monthKey => ({
      month: monthKey,
      loan: result[monthKey].loan,
      payback: result[monthKey].payback
    }));
  }

  function renderLoanBI() {
    const host = $('loanBI');
    if (!host) return;

    const rows = loanTrend();
    if (!rows.length) {
      host.innerHTML = '<div class=\"empty\">No loan or payback data yet</div>';
      return;
    }

    const max = Math.max(1, ...rows.flatMap(r => [r.loan, r.payback]));
    host.innerHTML = `
      <div class=\"loan-bi-legend\">
        <span><i class=\"loan-key\"></i>Loan received</span>
        <span><i class=\"payback-key\"></i>Payback</span>
      </div>
      <div class=\"loan-chart\">
        ${rows.map(r => `
          <div class=\"loan-chart-col\">
            <div class=\"loan-bars\">
              <span class=\"loan-bar\" title=\"Loan: ${money(r.loan)}\" style=\"height:${Math.max(2, (r.loan / max) * 100)}%\"></span>
              <span class=\"payback-bar\" title=\"Payback: ${money(r.payback)}\" style=\"height:${Math.max(2, (r.payback / max) * 100)}%\"></span>
            </div>
            <small>${esc(r.month)}</small>
            <b>${money(r.loan - r.payback)}</b>
          </div>
        `).join('')}
      </div>
    `;
  }

  function ensureLoanBI() {
    if ($('loanBI')) return;

    const dashboard = $('dashboard');
    if (!dashboard) return;

    const panel = document.createElement('div');
    panel.className = 'panel loan-bi-panel';
    panel.innerHTML = `
      <div class="head">
        <div>
          <small>LIABILITY REPORT</small>
          <h2>Loan vs Payback Trend</h2>
        </div>
      </div>
      <div id="loanBI"></div>
    `;
    dashboard.appendChild(panel);
  }

  function render() {
    ensureLoanBI();
    greeting();
    renderLoanSelect();
    updateMonthOptions();

    const xs = items();
    const t = totals(xs);
    const net = t.income - t.expense - t.credit;

    [['income', t.income], ['expense', t.expense], ['credit', t.credit], ['remaining', net]].forEach(([key, val]) => {
      const el = $(key);
      if (el) el.textContent = money(val);
    });

    if ($('txCount')) $('txCount').textContent = `Activity (${xs.length})`;

    const txList = $('txList');
    if (txList) {
      txList.innerHTML = xs.slice().reverse().map(tx => `
        <div class="row">
          <span>${esc(tx.type.toUpperCase())} ${esc(tx.category || 'General')}</span>
          <b class="${tx.type === 'income' ? 'up' : 'down'}">${tx.type === 'income' ? '+' : '-'}${money(tx.amount)}</b>
        </div>
      `).join('') || '<div class=\"empty\">No transactions</div>';
    }

    renderBudgets();
    renderGoals();
    renderReports();
    renderLoanBI();
    theme();
  }

  function injectPlanningUI() {
    if ($('planningStyles')) return;

    const st = document.createElement('style');
    st.id = 'planningStyles';
    st.textContent = `
      .planning-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .budget-card,.goal-card,.panel{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px}
      .budget-card .head,.goal-card .head,.loan-bi-panel .head{display:flex;justify-content:space-between;align-items:center}
      .bar{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:8px 0}
      .bar i{display:block;height:100%;background:linear-gradient(90deg,#2dd4bf,#60a5fa);border-radius:inherit}
      .budget-card.over .bar i{background:linear-gradient(90deg,#ef4444,#f97316)}
      .budget-card.near .bar i{background:linear-gradient(90deg,#fbbf24,#f59e0b)}
      .loan-bi-panel{margin-top:16px}
      .loan-bi-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;margin:8px 0 14px}
      .loan-bi-legend span{display:flex;align-items:center;gap:6px}
      .loan-bi-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
      .loan-key{background:#60a5fa}
      .payback-key{background:#f97316}
      .loan-chart{height:220px;display:flex;align-items:stretch;gap:10px;border-bottom:1px solid rgba(255,255,255,.16);overflow-x:auto;padding:0 4px}
      .loan-chart-col{min-width:70px;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;font-size:11px}
      .loan-chart-col b{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;max-width:70px;text-overflow:ellipsis}
      .loan-bars{height:175px;display:flex;align-items:flex-end;gap:4px}
      .loan-bar,.payback-bar{display:block;width:18px;min-height:2px;border-radius:5px 5px 0 0}
      .loan-bar{background:linear-gradient(180deg,#60a5fa,#2563eb)}
      .payback-bar{background:linear-gradient(180deg,#fb923c,#ea580c)}
    `;
    document.head.appendChild(st);
  }

  function theme() {
    document.body.classList.toggle('dark', state.settings.theme === 'dark');
    if ($('switch')) $('switch').classList.toggle('on', state.settings.theme === 'dark');
  }

  async function api(action, payload = {}) {
    if (!state.settings.syncUrl) throw Error('Add the Apps Script URL first.');

    const r = await fetch(state.settings.syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action }, payload))
    });

    const out = await r.json().catch(() => ({}));
    if (!out || !out.ok) throw Error((out && out.error) || 'Sync failed');
    return out.data || out;
  }

  async function pushChanges() {
    if (syncing || !state.settings.syncUrl) return;

    syncing = true;
    try {
      const r = await api('replaceAll', {
        transactions: state.transactions,
        categories: state.categories,
        budgets: state.budgets,
        goals: state.goals,
        loans: state.loans
      });

      state.settings.syncRevision = (r && r.revision) || state.settings.syncRevision;
      state.settings.lastSynced = new Date().toISOString();
      save();
      toast('Synced to Google Sheets');
    } catch (error) {
      toast(error.message || 'Sync failed');
    } finally {
      syncing = false;
      render();
    }
  }

  async function pull() {
    if (syncing || !state.settings.syncUrl) return;

    syncing = true;
    try {
      const r = await api('getAll');
      if (r && r.transactions) {
        state.transactions = r.transactions || [];
        state.categories = r.categories || [];
        state.budgets = r.budgets || [];
        state.goals = r.goals || [];
        state.loans = r.loans || [];
        save();
        toast('Pulled from Google Sheets');
      }
    } catch (error) {
      toast(error.message || 'Pull failed');
    } finally {
      syncing = false;
      render();
    }
  }

  document.addEventListener('click', e => {
    const pageButton = e.target.closest('[data-page]');
    if (pageButton) return show(pageButton.dataset.page);

    const addButton = e.target.closest('[data-add]');
    if (addButton) {
      setType(addButton.dataset.add);
      show('add');
      return;
    }

    const syncButton = e.target.closest('[data-sync]');
    if (syncButton) {
      if (syncButton.dataset.sync === 'push') return pushChanges();
      if (syncButton.dataset.sync === 'pull') return pull();
    }
  });

  document.addEventListener('submit', e => {
    if (e.target.id === 'budgetForm') {
      e.preventDefault();
      const category = $('budgetCategory').value;
      const amount = Number($('budgetAmount').value);

      if (!category || amount <= 0) return toast('Enter a valid budget amount');

      state.budgets = state.budgets.filter(b => b.category !== category);
      state.budgets.push({ category, amount });
      save();
      render();
      toast('Budget saved');
      return;
    }

    if (e.target.id === 'form') {
      e.preventDefault();

      const amount = Number($('amount').value);
      if (!amount || amount <= 0) return toast('Enter an amount greater than 0');

      const type = state.currentType;
      const date = $('date') ? ($('date').value || today) : today;
      const note = ($('note') && $('note').value || '').trim();
      let loanId = $('loanSelect') ? ($('loanSelect').value || '') : '';

      const tx = {
        id: uid('tx'),
        type,
        amount,
        date,
        category: ($('category') && $('category').value) || 'General',
        note,
        loanId,
        createdAt: new Date().toISOString()
      };

      if (type === 'loan') {
        tx.type = 'income';
        tx.category = 'Loan';
        tx.loanId = uid('loan');

        const existing = (state.loans || []).find(l => String(l.id) === String(tx.loanId));
        if (existing) {
          existing.principal = (Number(existing.principal) || 0) + amount;
          existing.remaining = (Number(existing.remaining) || 0) + amount;
        } else {
          state.loans.push({
            id: tx.loanId,
            name: note || 'Loan',
            principal: amount,
            remaining: amount,
            date,
            note,
            createdAt: tx.createdAt
          });
        }
      } else if (type === 'payback') {
        if (!loanId) return toast('Select a loan to pay back');
        tx.type = 'expense';
        tx.category = 'Loan Repayment';
        tx.loanId = loanId;

        const loan = (state.loans || []).find(l => String(l.id) === String(loanId));
        if (!loan) return toast('Selected loan was not found');

        if (amount > Number(loan.remaining || 0)) {
          return toast('Payback cannot exceed remaining loan');
        }

        loan.remaining = Math.max(0, Number(loan.remaining || 0) - amount);
      } else {
        tx.type = type;
      }

      state.transactions.push(tx);
      save();
      render();
      toast(type === 'loan' ? 'Loan saved' : type === 'payback' ? 'Loan payback saved' : 'Saved');

      if ($('form')) $('form').reset();
      if ($('date')) $('date').value = today;
      if ($('loanSelect')) $('loanSelect').disabled = true;
    }
  });

  ['theme', 'switch'].forEach(id => $(id)?.addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('dark', state.settings.theme === 'dark');
    save();
  }));

  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'syncUrl') {
      state.settings.syncUrl = e.target.value.trim();
      save();
    }
  });

  function bindUI() {
    const syncUrl = $('syncUrl');
    if (syncUrl) syncUrl.value = state.settings.syncUrl || '';

    const budgetCategory = $('budgetCategory');
    if (budgetCategory) {
      const categories = (state.categories || []).filter(c => c.type === 'expense');
      budgetCategory.innerHTML = categories.length
        ? categories.map(c => `<option value="${c.name}">${esc(c.name)}</option>`).join('')
        : '<option value="">General</option>';
    }
  }

  injectPlanningUI();
  bindUI();
  if ($('date')) $('date').value = today;
  setType(state.currentType);
  render();
  show('home');
})();
