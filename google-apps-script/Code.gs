const SPREADSHEET_ID = '';

const TRANSACTION_HEADERS = ['id', 'type', 'amount', 'date', 'category', 'note', 'loanId', 'createdAt'];
const CATEGORY_HEADERS = ['name', 'type', 'createdAt'];
const BUDGET_HEADERS = ['category', 'amount'];
const GOAL_HEADERS = ['name', 'target', 'saved'];
const LOAN_HEADERS = ['id', 'name', 'principal', 'remaining', 'date', 'note', 'createdAt'];

function ss() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (action === 'getAll') return json({ ok: true, data: readAll() });
    if (action === 'status') return json({ ok: true, data: status() });
    return json({ ok: true, message: 'MoneyFlow API is running' });
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) });
  }
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const request = JSON.parse(body);
    if (request.action === 'getAll') return json({ ok: true, data: readAll() });
    if (request.action === 'status') return json({ ok: true, data: status() });
    if (request.action === 'replaceAll' || request.action === 'writeAll') return json({ ok: true, data: writeAll(request) });
    return json({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) });
  }
}

function sheet(name, headers) {
  const book = ss();
  const target = book.getSheetByName(name) || book.insertSheet(name);
  if (target.getLastRow() === 0) target.getRange(1, 1, 1, headers.length).setValues([headers]);
  target.setFrozenRows(1);
  return target;
}

function rows(name, headers) {
  const values = sheet(name, headers).getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
    const item = {};
    headers.forEach((header, index) => { item[header] = row[index]; });
    return item;
  });
}

function writeTable(name, headers, values) {
  const target = sheet(name, headers);
  target.clearContents();
  target.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) target.getRange(2, 1, values.length, headers.length).setValues(values);
  target.setFrozenRows(1);
}

function num(value) {
  const result = Number(String(value == null ? '' : value).replace(/,/g, ''));
  return isFinite(result) ? result : 0;
}

function today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function iso(value) {
  const date = value ? new Date(value) : new Date();
  return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function formatDate(value) {
  if (!value) return today();
  if (Object.prototype.toString.call(value) === '[object Date]') return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : today();
}

function normalizeTransaction(value) {
  const item = value || {};
  let type = String(item.type || 'expense');
  const category = String(item.category || 'General');
  if (type === 'loan' || category.toLowerCase() === 'loan') type = 'income';
  if (category.toLowerCase() === 'loan repayment' || category.toLowerCase() === 'loan payback') type = 'expense';
  return {
    id: String(item.id || Utilities.getUuid()), type: type, amount: num(item.amount),
    date: formatDate(item.date), category: category, note: String(item.note || ''),
    loanId: String(item.loanId || ''), createdAt: iso(item.createdAt)
  };
}

function normalizeCategory(value) {
  const item = value || {};
  return { name: String(item.name || '').trim(), type: String(item.type || 'expense'), createdAt: iso(item.createdAt) };
}

function normalizeBudget(value) {
  const item = value || {};
  return { category: String(item.category || '').trim(), amount: num(item.amount) };
}

function normalizeGoal(value) {
  const item = value || {};
  return { name: String(item.name || '').trim(), target: num(item.target), saved: num(item.saved) };
}

function normalizeLoan(value) {
  const item = value || {};
  const principal = num(item.principal || item.amount);
  return {
    id: String(item.id || Utilities.getUuid()), name: String(item.name || 'Loan').trim(),
    principal: principal, remaining: Math.max(0, num(item.remaining === undefined ? principal : item.remaining)),
    date: formatDate(item.date), note: String(item.note || ''), createdAt: iso(item.createdAt)
  };
}

function uniqueCategories(values) {
  const result = [];
  values.forEach(value => {
    const item = normalizeCategory(value);
    if (!item.name) return;
    if (!result.some(existing => existing.name.toLowerCase() === item.name.toLowerCase() && existing.type === item.type)) result.push(item);
  });
  return result;
}

function addMissingLoans(loans, transactions) {
  const result = loans.slice();
  transactions.filter(tx => tx.type === 'income' && tx.loanId).forEach(tx => {
    if (!result.some(loan => String(loan.id) === String(tx.loanId))) {
      result.push(normalizeLoan({ id: tx.loanId, name: tx.note || 'Loan', principal: tx.amount, remaining: tx.amount, date: tx.date, note: tx.note, createdAt: tx.createdAt }));
    }
  });
  return result;
}

function applyRepayments(loans, transactions) {
  return loans.map(loan => {
    const copy = Object.assign({}, loan);
    const paid = transactions.filter(tx => tx.type === 'expense' && tx.loanId && String(tx.loanId) === String(copy.id)).reduce((sum, tx) => sum + num(tx.amount), 0);
    copy.remaining = Math.max(0, num(copy.remaining) - paid);
    return copy;
  });
}

function readAll() {
  const transactions = rows('Transactions', TRANSACTION_HEADERS).map(normalizeTransaction);
  const categories = uniqueCategories(rows('Categories', CATEGORY_HEADERS));
  const budgets = rows('Budgets', BUDGET_HEADERS).map(normalizeBudget).filter(item => item.category);
  const goals = rows('Goals', GOAL_HEADERS).map(normalizeGoal).filter(item => item.name);
  const rawLoans = rows('Loans', LOAN_HEADERS).map(normalizeLoan);
  const loans = applyRepayments(addMissingLoans(rawLoans, transactions), transactions);
  const data = { transactions, categories, budgets, goals, loans };
  data.revision = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(data), Utilities.Charset.UTF_8));
  return data;
}

function status() {
  const data = readAll();
  return { revision: data.revision, count: data.transactions.length, categoryCount: data.categories.length, budgetCount: data.budgets.length, goalCount: data.goals.length, loanCount: data.loans.length };
}

function writeAll(payload) {
  const transactions = (payload.transactions || []).map(normalizeTransaction);
  const categories = uniqueCategories(payload.categories || []);
  const budgets = (payload.budgets || []).map(normalizeBudget).filter(item => item.category);
  const goals = (payload.goals || []).map(normalizeGoal).filter(item => item.name);
  const loans = applyRepayments(addMissingLoans((payload.loans || []).map(normalizeLoan).filter(item => item.id), transactions), transactions);

  writeTable('Transactions', TRANSACTION_HEADERS, transactions.map(tx => [tx.id, tx.type, tx.amount, tx.date, tx.category, tx.note, tx.loanId, tx.createdAt]));
  writeTable('Categories', CATEGORY_HEADERS, categories.map(item => [item.name, item.type, item.createdAt]));
  writeTable('Budgets', BUDGET_HEADERS, budgets.map(item => [item.category, item.amount]));
  writeTable('Goals', GOAL_HEADERS, goals.map(item => [item.name, item.target, item.saved]));
  writeTable('Loans', LOAN_HEADERS, loans.map(item => [item.id, item.name, item.principal, item.remaining, item.date, item.note, item.createdAt]));
  return readAll();
}
