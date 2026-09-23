(() => {
  'use strict';
  const KEY = 'moneyflow-v3';
  const $ = id => document.getElementById(id);
  const money = value => `${Math.round(Number(value) || 0).toLocaleString()} MMK`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); s.transactions = Array.isArray(s.transactions) ? s.transactions : []; s.loans = Array.isArray(s.loans) ? s.loans : []; s.reportMonth = s.reportMonth || new Date().toISOString().slice(0, 7); return s; } catch (_) { return {transactions:[],loans:[],reportMonth:new Date().toISOString().slice(0,7)}; } };
  const save = state => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };

  function repairLoanRecords() {
    const state = read();
    let changed = false;
    state.transactions.forEach(tx => {
      const category = String(tx.category || '').toLowerCase();
      const isLoanReceipt = category === 'loan' || category === 'loan received' || tx.loanType === 'loan';
      const isPayback = category === 'loan repayment' || category === 'loan payback' || tx.loanType === 'payback';
      if (isLoanReceipt && tx.type !== 'income') { tx.type = 'income'; changed = true; }
      if (isPayback && tx.type !== 'expense') { tx.type = 'expense'; changed = true; }
      if (isLoanReceipt && !tx.loanId) { tx.loanId = `loan-${tx.id || Date.now()}`; changed = true; }
    });
    state.transactions.filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
      let loan = state.loans.find(item => String(item.id) === String(tx.loanId));
      if (!loan) { state.loans.push({id:tx.loanId,name:tx.note || 'Loan',principal:Number(tx.amount)||0,remaining:Number(tx.amount)||0,date:tx.date,note:tx.note || '',createdAt:tx.createdAt}); changed = true; }
    });
    if (changed) save(state);
    return state;
  }

  function renderLoanSummary() {
    const state = read();
    const month = state.reportMonth;
    const rows = state.transactions.filter(tx => String(tx.date || '').slice(0, 7) === month);
    const payback = rows.filter(tx => tx.type === 'expense' && tx.loanId).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    const received = rows.filter(tx => tx.type === 'income' && tx.loanId).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    if ($('loan')) $('loan').textContent = money(payback);
    if ($('loanSummary')) $('loanSummary').textContent = money(state.loans.reduce((sum, loan) => sum + (Number(loan.remaining) || 0), 0));
    const host = $('loanBI');
    if (host && !host.dataset.loanFixRendered) {
      host.dataset.loanFixRendered = 'true';
      const outstanding = state.loans.reduce((sum, loan) => sum + (Number(loan.remaining) || 0), 0);
      host.innerHTML = `<div class="loan-bi-grid"><div class="loan-bi-stat"><small>Loan received</small><strong>${money(received)}</strong></div><div class="loan-bi-stat"><small>Loan payback</small><strong>${money(payback)}</strong></div><div class="loan-bi-stat"><small>Outstanding liability</small><strong>${money(outstanding)}</strong></div></div><div class="loan-bi-list">${state.loans.length ? state.loans.map(loan => `<div class="loan-bi-row"><span>${esc(loan.name || 'Loan')}<small>Principal: ${money(loan.principal)}</small></span><b>${money(loan.remaining)}</b></div>`).join('') : '<div class="empty">No loan records yet</div>'}</div>`;
    }
  }

  function refresh() { repairLoanRecords(); renderLoanSummary(); }
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-type]');
    if (tab && !tab.dataset.add) tab.dataset.add = tab.dataset.type;
    const quick = event.target.closest('[data-add="loan"], [data-add="payback"]');
    if (quick) quick.classList.add(quick.dataset.add === 'payback' ? 'payback-action' : 'loan-action');
    if (event.target.closest('[data-page="dashboard"]')) setTimeout(refresh, 0);
  });
  document.addEventListener('submit', () => setTimeout(refresh, 0));
  document.addEventListener('change', event => { if (event.target.id === 'month') setTimeout(refresh, 0); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, {once:true}); else refresh();
})();
