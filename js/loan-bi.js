(() => {
  'use strict';

  // Additive loan/report enhancement. It observes the existing MoneyFlow state
  // and does not replace existing handlers, forms, or navigation.
  const STORAGE_KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const money = value => `${Math.round(Number(value) || 0).toLocaleString()} MMK`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const readState = () => {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      state.transactions = Array.isArray(state.transactions) ? state.transactions : [];
      state.loans = Array.isArray(state.loans) ? state.loans : [];
      state.reportMonth = state.reportMonth || new Date().toISOString().slice(0, 7);
      return state;
    } catch (_) {
      return { transactions: [], loans: [], reportMonth: new Date().toISOString().slice(0, 7) };
    }
  };

  const loanData = state => {
    const loans = state.loans.map(loan => ({
      id: String(loan.id || ''),
      name: String(loan.name || 'Loan'),
      principal: Number(loan.principal) || 0,
      remaining: Math.max(0, Number(loan.remaining) || 0)
    }));

    const byId = new Map(loans.map(loan => [loan.id, loan]));
    state.transactions.forEach(tx => {
      if (!tx.loanId) return;
      const amount = Number(tx.amount) || 0;
      let loan = byId.get(String(tx.loanId));
      if (!loan && tx.type === 'income') {
        loan = { id: String(tx.loanId), name: String(tx.note || 'Loan'), principal: amount, remaining: amount };
        byId.set(loan.id, loan);
      }
      if (!loan) return;
      if (tx.type === 'income') loan.principal += byId.has(loan.id) && loan.principal ? 0 : amount;
      if (tx.type === 'expense') loan.remaining = Math.max(0, loan.remaining - amount);
    });

    return Array.from(byId.values());
  };

  const reportData = state => {
    const month = state.reportMonth;
    const rows = state.transactions.filter(tx => String(tx.date || '').slice(0, 7) === month);
    const result = { income: 0, expense: 0, credit: 0, loanIn: 0, payback: 0, byCategory: {} };
    rows.forEach(tx => {
      const amount = Number(tx.amount) || 0;
      if (tx.type === 'income') { result.income += amount; if (tx.loanId) result.loanIn += amount; }
      if (tx.type === 'expense') { result.expense += amount; if (tx.loanId) result.payback += amount; const key = tx.category || 'General'; result.byCategory[key] = (result.byCategory[key] || 0) + amount; }
      if (tx.type === 'credit') result.credit += amount;
    });
    result.net = result.income - result.expense - result.credit;
    return result;
  };

  function inject() {
    if ($('loanBiEnhancement')) return;
    const dashboard = $('dashboard');
    if (!dashboard) return;

    const style = document.createElement('style');
    style.id = 'loanBiEnhancementStyles';
    style.textContent = '.loan-bi-enhancement{margin-top:16px}.loan-bi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.loan-bi-stat{padding:10px;border:1px solid var(--line,rgba(148,163,184,.2));border-radius:12px}.loan-bi-stat small{display:block;color:var(--muted)}.loan-bi-stat strong{display:block;margin-top:4px}.loan-bi-list{display:grid;gap:8px;margin-top:12px}.loan-bi-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line,rgba(148,163,184,.2));padding:8px 0}.loan-bi-bar{height:7px;border-radius:99px;background:rgba(148,163,184,.2);overflow:hidden;margin-top:5px}.loan-bi-bar i{display:block;height:100%;background:linear-gradient(90deg,#60a5fa,#2dd4bf)}@media(max-width:760px){.loan-bi-grid{grid-template-columns:1fr}}';
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'loanBiEnhancement';
    panel.className = 'panel loan-bi-enhancement';
    panel.innerHTML = '<div class="head"><div><small>LIABILITY &amp; REPORT BI</small><h2>Loan overview</h2></div></div><div id="loanBiEnhancementBody"></div>';
    dashboard.appendChild(panel);
  }

  function render() {
    const body = $('loanBiEnhancementBody');
    if (!body) return;
    const state = readState();
    const report = reportData(state);
    const loans = loanData(state);
    const maxCategory = Math.max(1, ...Object.values(report.byCategory));
    body.innerHTML = `<div class="loan-bi-grid"><div class="loan-bi-stat"><small>Loan received</small><strong>${money(report.loanIn)}</strong></div><div class="loan-bi-stat"><small>Payback</small><strong>${money(report.payback)}</strong></div><div class="loan-bi-stat"><small>Outstanding</small><strong>${money(loans.reduce((sum, loan) => sum + loan.remaining, 0))}</strong></div><div class="loan-bi-stat"><small>Net cash flow</small><strong>${money(report.net)}</strong></div></div><div class="loan-bi-list">${loans.length ? loans.map(loan => `<div class="loan-bi-row"><span>${escapeHtml(loan.name)}<small>${money(loan.principal)} principal</small></span><b>${money(loan.remaining)}</b></div>`).join('') : '<div class="empty">No loan data yet</div>'}</div><div class="loan-bi-list">${Object.entries(report.byCategory).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([category, amount]) => `<div><div class="loan-bi-row"><span>${escapeHtml(category)}</span><b>${money(amount)}</b></div><div class="loan-bi-bar"><i style="width:${Math.min(100, amount / maxCategory * 100)}%"></i></div></div>`).join('') || '<div class="empty">No expense data for this month</div>'}</div>`;
  }

  function start() {
    inject();
    render();
    window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) render(); });
    document.addEventListener('click', event => { if (event.target.closest('[data-page="dashboard"]')) setTimeout(render, 0); });
    document.addEventListener('submit', () => setTimeout(render, 0));
    document.addEventListener('change', event => { if (event.target.id === 'month') setTimeout(render, 0); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
