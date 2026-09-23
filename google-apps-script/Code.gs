/**
 * MoneyFlow Google Sheets API
 *
 * Required sheets and columns are created automatically:
 *
 * Transactions:
 * id | type | amount | date | category | note | loanId | createdAt
 *
 * Categories:
 * name | type | createdAt
 *
 * Budgets:
 * category | amount
 *
 * Goals:
 * name | target | saved
 *
 * Loans:
 * id | name | principal | remaining | date | note | createdAt
 *
 * Loan rules:
 * - A new loan is written to Loans and also appears as an income transaction.
 * - A payback is written as an expense transaction and reduces the selected loan's remaining balance.
 * - Loan amounts are never counted as loan expenses. Only paybacks affect expenses.
 */

const SPREADSHEET_ID = '';

const TRANSACTION_HEADERS = ['id', 'type', 'amount', 'date', 'category', 'note', 'loanId', 'createdAt'];
const CATEGORY_HEADERS = ['name', 'type', 'createdAt'];
const BUDGET_HEADERS = ['category', 'amount'];
const GOAL_HEADERS = ['name', 'target', 'saved'];
const LOAN_HEADERS = ['id', 'name', 'principal', 'remaining', 'date', 'note', 'createdAt'];

function ss() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function out(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;
    if (action === 'getAll') return out({ ok: true, data: readAll() });
    if (action === 'status') return out({ ok: true, data: status() });
    return out({ ok: true, message: 'MoneyFlow API is running' });
  } catch (error) {
    return out({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = request.action;

    if (action === 'getAll') return out({ ok: true, data: readAll() });
    if (action === 'status') return out({ ok: true, data: status() });
    if (action === 'replaceAll' || action === 'writeAll') {
      return out({ ok: true, data: writeAll(request) });
    }

    return out({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return out({ ok: false, error: error.message });
  }
}

function sheet(name, headers) {
  const existing = ss().getSheetByName(name);
  const result = existing || ss().insertSheet(name);
  if (result.getLastRow() === 0) {
    result.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  result.setFrozenRows(1);
  return result;
}

function rows(name, headers) {
  const values = sheet(name, headers).getDataRange().getValues();
  if (values.length < 2) return [];

  return values.slice(1)
    .filter(row => row.some(value => value !== ''))
    .map(row => {
      const object = {};
      headers.forEach((header, index) => object[header] = row[index]);
      return object;
    });
}

function normalizeTransaction(value) {
  const type = String(value.type || 'expense');
  return {
    id: String(value.id || Utilities.getUuid()),
    type: type === 'loan' ? 'income' : type,
    amount: number(value.amount),
    date: formatDate(value.date) || today(),
    category: String(value.category || (value.loanId ? 'Loan' : 'General')),
    note: String(value.note || ''),
    loanId: String(value.loanId || ''),
    createdAt: iso(value.createdAt)
  };
}

function normalizeCategory(value) {
  return {
    name: String(value.name || '').trim(),
    type: String(value.type || 'expense'),
    createdAt: iso(value.createdAt)
  };
}

function normalizeBudget(value) {
  return {
    category: String(value.category || '').trim(),
    amount: number(value.amount)
  };
}

function normalizeGoal(value) {
  return {
    name: String(value.name || '').trim(),
    target: number(value.target),
    saved: number(value.saved)
  };
}

function normalizeLoan(value) {
  const principal = number(value.principal || value.amount);
  return {
    id: String(value.id || Utilities.getUuid()),
    name: String(value.name || 'Loan').trim(),
    principal: principal,
    remaining: Math.max(0, number(value.remaining === undefined ? principal : value.remaining)),
    date: formatDate(value.date) || today(),
    note: String(value.note || ''),
    createdAt: iso(value.createdAt)
  };
}

function uniqueCategories(values) {
  const result = [];
  values.forEach(value => {
    const category = normalizeCategory(value);
    if (!category.name) return;
    const duplicate = result.some(item =>
      item.name.toLowerCase() === category.name.toLowerCase() && item.type === category.type
    );
    if (!duplicate) result.push(category);
  });
  return result;
}

function readAll() {
  const transactions = rows('Transactions', TRANSACTION_HEADERS).map(normalizeTransaction);
  const categories = uniqueCategories(rows('Categories', CATEGORY_HEADERS));
  const budgets = rows('Budgets', BUDGET_HEADERS).map(normalizeBudget);
  const goals = rows('Goals', GOAL_HEADERS).map(normalizeGoal);
  const loans = rows('Loans', LOAN_HEADERS).map(normalizeLoan);

  // For old spreadsheets, reconstruct loans from legacy loan transactions.
  const reconstructed = loans.slice();
  transactions
    .filter(transaction => transaction.type === 'income' && transaction.loanId && !reconstructed.some(loan => loan.id === transaction.loanId))
    .forEach(transaction => reconstructed.push(normalizeLoan({
      id: transaction.loanId,
      name: transaction.note || 'Loan',
      principal: transaction.amount,
      remaining: transaction.amount,
      date: transaction.date,
      note: transaction.note,
      createdAt: transaction.createdAt
    })));

  return {
    transactions: transactions,
    categories: categories,
    budgets: budgets,
    goals: goals,
    loans: applyRepayments(reconstructed, transactions),
    revision: fingerprint({ transactions, categories, budgets, goals, loans: reconstructed })
  };
}

function applyRepayments(loans, transactions) {
  const result = loans.map(loan => Object.assign({}, loan));
  transactions
    .filter(transaction => transaction.type === 'expense' && transaction.loanId)
    .forEach(transaction => {
      const loan = result.find(item => item.id === transaction.loanId);
      if (loan) loan.remaining = Math.max(0, loan.remaining - transaction.amount);
    });
  return result;
}

function status() {
  const data = readAll();
  return {
    revision: data.revision,
    count: data.transactions.length,
    categoryCount: data.categories.length,
    budgetCount: data.budgets.length,
    goalCount: data.goals.length,
    loanCount: data.loans.length
  };
}

function writeAll(payload) {
  const transactions = (payload.transactions || []).map(normalizeTransaction);
  const categories = uniqueCategories(payload.categories || []);
  const budgets = (payload.budgets || []).map(normalizeBudget).filter(item => item.category);
  const goals = (payload.goals || []).map(normalizeGoal).filter(item => item.name);

  // Accept loans from the new client. If the client has not yet been updated,
  // derive them from income transactions carrying loanId.
  let loans = (payload.loans || []).map(normalizeLoan).filter(item => item.id);
  transactions
    .filter(transaction => transaction.type === 'income' && transaction.loanId)
    .forEach(transaction => {
      if (!loans.some(loan => loan.id === transaction.loanId)) {
        loans.push(normalizeLoan({
          id: transaction.loanId,
          name: transaction.note || 'Loan',
          principal: transaction.amount,
          remaining: transaction.amount,
          date: transaction.date,
          note: transaction.note,
          createdAt: transaction.createdAt
        }));
      }
    });
  loans = applyRepayments(loans, transactions);

  writeTable('Transactions', TRANSACTION_HEADERS, transactions.map(transaction => [
    transaction.id, transaction.type, transaction.amount, transaction.date,
    transaction.category, transaction.note, transaction.loanId, transaction.createdAt
  ]));
  writeTable('Categories', CATEGORY_HEADERS, categories.map(category => [
    category.name, category.type, category.createdAt
  ]));
  writeTable('Budgets', BUDGET_HEADERS, budgets.map(budget => [budget.category, budget.amount]));
  writeTable('Goals', GOAL_HEADERS, goals.map(goal => [goal.name, goal.target, goal.saved]));
  writeTable('Loans', LOAN_HEADERS, loans.map(loan => [
    loan.id, loan.name, loan.principal, loan.remaining,
    loan.date, loan.note, loan.createdAt
  ]));

  return readAll();
}

function writeTable(name, headers, values) {
  const target = sheet(name, headers);
  target.clearContents();
  target.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) target.getRange(2, 1, values.length, headers.length).setValues(values);
  target.setFrozenRows(1);
}

function number(value) {
  const result = Number(value);
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
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value).slice(0, 10);
}

function fingerprint(value) {
  return Utilities.base64Encode(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      JSON.stringify(value),
      Utilities.Charset.UTF_8
    )
  );
}
