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

const TRANSACTION_HEADERS = [
  'id',
  'type',
  'amount',
  'date',
  'category',
  'note',
  'loanId',
  'createdAt'
];

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
  const book = ss();
  const target = book.getSheetByName(name) || book.insertSheet(name);

  if (target.getLastRow() === 0) {
    target.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  target.setFrozenRows(1);
  return target;
}

function rows(name, headers) {
  const values = sheet(name, headers).getDataRange().getValues();
  if (values.length < 2) return [];

  return values.slice(1)
    .filter(row => row.some(value => value !== ''))
    .map(row => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index];
      });
      return item;
    });
}

function writeTable(name, headers, values) {
  const target = sheet(name, headers);
  target.clearContents();
  target.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (values.length) {
    target.getRange(2, 1, values.length, headers.length).setValues(values);
  }

  target.setFrozenRows(1);
}

function number(value) {
  const x = Number(value);
  return isFinite(x) ? x : 0;
}

function today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function iso(value) {
  const d = value ? new Date(value) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function formatDate(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value).slice(0, 10);
}

function normalizeTransaction(value) {
  const item = value || {};
  const type = String(item.type || 'expense');

  return {
    id: String(item.id || Utilities.getUuid()),
    type: type === 'loan' ? 'income' : type,
    amount: number(item.amount),
    date: formatDate(item.date) || today(),
    category: String(item.category || 'General'),
    note: String(item.note || ''),
    loanId: String(item.loanId || ''),
    createdAt: iso(item.createdAt)
  };
}

function normalizeCategory(value) {
  const item = value || {};

  return {
    name: String(item.name || '').trim(),
    type: String(item.type || 'expense'),
    createdAt: iso(item.createdAt)
  };
}

function normalizeBudget(value) {
  const item = value || {};
  return {
    category: String(item.category || '').trim(),
    amount: number(item.amount)
  };
}

function normalizeGoal(value) {
  const item = value || {};
  return {
    name: String(item.name || '').trim(),
    target: number(item.target),
    saved: number(item.saved)
  };
}

function normalizeLoan(value) {
  const item = value || {};
  return {
    id: String(item.id || Utilities.getUuid()),
    name: String(item.name || 'Loan').trim(),
    principal: number(item.principal || item.amount),
    remaining: Math.max(0, number(item.remaining === undefined ? (item.principal || item.amount) : item.remaining)),
    date: formatDate(item.date) || today(),
    note: String(item.note || ''),
    createdAt: iso(item.createdAt)
  };
}

function uniqueCategories(values) {
  const result = [];
  values.forEach(value => {
    const item = normalizeCategory(value);
    if (!item.name) return;

    const exists = result.some(x =>
      x.name.toLowerCase() === item.name.toLowerCase() &&
      x.type === item.type
    );

    if (!exists) result.push(item);
  });

  return result;
}

function applyLoanRepayments(loans, transactions) {
  const result = (loans || []).map(loan => ({ ...loan }));

  (transactions || [])
    .filter(tx => tx.type === 'expense' && tx.loanId)
    .forEach(tx => {
      const loan = result.find(x => x.id === tx.loanId);
      if (loan) {
        loan.remaining = Math.max(0, Number(loan.remaining || 0) - Number(tx.amount || 0));
      }
    });

  return result;
}

function readAll() {
  const transactions = rows('Transactions', TRANSACTION_HEADERS).map(normalizeTransaction);
  const categories = uniqueCategories(rows('Categories', CATEGORY_HEADERS));
  const budgets = rows('Budgets', BUDGET_HEADERS).map(normalizeBudget);
  const goals = rows('Goals', GOAL_HEADERS).map(normalizeGoal);
  const rawLoans = rows('Loans', LOAN_HEADERS).map(normalizeLoan);

  let loans = applyLoanRepayments(rawLoans, transactions);

  transactions
    .filter(tx => tx.type === 'income' && tx.loanId)
    .forEach(tx => {
      const exists = loans.some(item => item.id === tx.loanId);
      if (!exists) {
        loans.push(normalizeLoan({
          id: tx.loanId,
          name: tx.note || 'Loan',
          principal: tx.amount,
          remaining: tx.amount,
          date: tx.date,
          note: tx.note,
          createdAt: tx.createdAt
        }));
      }
    });

  loans = applyLoanRepayments(loans, transactions);

  return {
    transactions,
    categories,
    budgets,
    goals,
    loans,
    revision: Utilities.base64Encode(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5,
        JSON.stringify({ transactions, categories, budgets, goals, loans }),
        Utilities.Charset.UTF_8
      )
    )
  };
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
  const budgets = (payload.budgets || []).map(normalizeBudget).filter(x => x.category);
  const goals = (payload.goals || []).map(normalizeGoal).filter(x => x.name);

  let loans = (payload.loans || []).map(normalizeLoan).filter(x => x.id);

  transactions
    .filter(tx => tx.type === 'income' && tx.loanId)
    .forEach(tx => {
      const exists = loans.some(item => item.id === tx.loanId);
      if (!exists) {
        loans.push(normalizeLoan({
          id: tx.loanId,
          name: tx.note || 'Loan',
          principal: tx.amount,
          remaining: tx.amount,
          date: tx.date,
          note: tx.note,
          createdAt: tx.createdAt
        }));
      }
    });

  loans = applyLoanRepayments(loans, transactions);

  writeTable('Transactions', TRANSACTION_HEADERS, transactions.map(tx => [
    tx.id,
    tx.type,
    tx.amount,
    tx.date,
    tx.category,
    tx.note,
    tx.loanId,
    tx.createdAt
  ]));

  writeTable('Categories', CATEGORY_HEADERS, categories.map(cat => [
    cat.name,
    cat.type,
    cat.createdAt
  ]));

  writeTable('Budgets', BUDGET_HEADERS, budgets.map(b => [
    b.category,
    b.amount
  ]));

  writeTable('Goals', GOAL_HEADERS, goals.map(g => [
    g.name,
    g.target,
    g.saved
  ]));

  writeTable('Loans', LOAN_HEADERS, loans.map(loan => [
    loan.id,
    loan.name,
    loan.principal,
    loan.remaining,
    loan.date,
    loan.note,
    loan.createdAt
  ]));

  return readAll();
}
