const { db } = require('./db');

function inClause(column, ids) {
  if (ids === null || ids === undefined) return { sql: '', params: [] };
  const pl = ids.map(() => '?').join(',');
  return { sql: ` AND ${column} IN (${pl})`, params: ids };
}

/**
 * Сводка по проекту (или всем проектам) за период.
 * Фильтры: projectId, projectIds (массив доступных), dateFrom, dateTo, categoryId, employeeId
 */
function buildReport(portal, filters = {}) {
  const where = ['t.portal = ?'];
  const params = [portal];

  if (filters.projectId) { where.push('t.project_id = ?'); params.push(filters.projectId); }
  const scope = inClause('t.project_id', filters.projectIds);
  if (scope.sql || (filters.projectIds && filters.projectIds.length === 0)) {
    // пустой список доступных проектов — отчёт будет пустым за счёт scope
  }
  if (scope.sql) { where.push(scope.sql.slice(4)); params.push(...scope.params); }
  else if (filters.projectIds && filters.projectIds.length === 0) {
    where.push('1 = 0'); // нет ни одного доступного проекта
  }
  if (filters.categoryId) { where.push('t.category_id = ?'); params.push(filters.categoryId); }
  if (filters.employeeId) { where.push('t.employee_id = ?'); params.push(filters.employeeId); }
  if (filters.dateFrom) { where.push('t.date >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('t.date <= ?'); params.push(filters.dateTo); }

  const whereSql = where.join(' AND ');

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense,
      COUNT(*) AS count
    FROM transactions t WHERE ${whereSql}
  `).get(...params);

  const income = totals.income;
  const expense = totals.expense;
  const profit = income - expense;
  const margin = income > 0 ? (profit / income) * 100 : 0;

  const byCategory = db.prepare(`
    SELECT c.id, c.name, c.type,
      SUM(t.amount) AS total
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE ${whereSql}
    GROUP BY c.id, c.name, c.type
    ORDER BY c.type, total DESC
  `).all(...params);

  const byMonth = db.prepare(`
    SELECT substr(t.date, 1, 7) AS month,
      COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
    FROM transactions t WHERE ${whereSql}
    GROUP BY substr(t.date, 1, 7)
    ORDER BY month
  `).all(...params);

  return {
    income: round2(income),
    expense: round2(expense),
    profit: round2(profit),
    margin: round1(margin),
    count: totals.count,
    byCategory,
    byMonth: byMonth.map(m => ({
      month: m.month,
      income: round2(m.income),
      expense: round2(m.expense),
      profit: round2(m.income - m.expense)
    }))
  };
}

/** Список транзакций с названиями проекта/статьи/сотрудника и пагинацией */
function listTransactions(portal, filters = {}, page = 1, perPage = 50) {
  const where = ['t.portal = ?'];
  const params = [portal];

  if (filters.projectId) { where.push('t.project_id = ?'); params.push(filters.projectId); }
  const scope = inClause('t.project_id', filters.projectIds);
  if (scope.sql) { where.push(scope.sql.slice(4)); params.push(...scope.params); }
  else if (filters.projectIds && filters.projectIds.length === 0) {
    where.push('1 = 0');
  }
  if (filters.categoryId) { where.push('t.category_id = ?'); params.push(filters.categoryId); }
  if (filters.type) { where.push('t.type = ?'); params.push(filters.type); }
  if (filters.dateFrom) { where.push('t.date >= ?'); params.push(filters.dateFrom); }
  if (filters.dateTo) { where.push('t.date <= ?'); params.push(filters.dateTo); }

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM transactions t WHERE ${whereSql}`).get(...params).c;
  const offset = (page - 1) * perPage;

  const rows = db.prepare(`
    SELECT t.*, p.name AS project_name, c.name AS category_name, e.name AS employee_name
    FROM transactions t
    JOIN projects p ON p.id = t.project_id
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN employees e ON e.id = t.employee_id
    WHERE ${whereSql}
    ORDER BY t.date DESC, t.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset);

  return { total, page, perPage, items: rows.map(r => ({ ...r, author_name: r.author_name || '' })) };
}

/** Профит по каждому проекту (для дашборда) с учётом периода */
function projectsSummary(portal, dateFrom, dateTo, projectIds) {
  const scope = inClause('p.id', projectIds);
  const rows = db.prepare(`
    SELECT p.id, p.name, p.color, p.budget,
      COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) AS expense
    FROM projects p
    LEFT JOIN transactions t ON t.project_id = p.id AND t.portal = p.portal
      AND (? IS NULL OR t.date >= ?) AND (? IS NULL OR t.date <= ?)
    WHERE p.portal = ?${scope.sql}
    GROUP BY p.id
    ORDER BY income - expense DESC
  `).all(dateFrom, dateFrom, dateTo, dateTo, portal, ...scope.params);

  return rows.map(p => {
    const profit = p.income - p.expense;
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      budget: p.budget,
      income: round2(p.income),
      expense: round2(p.expense),
      profit: round2(profit),
      margin: round1(p.income > 0 ? (profit / p.income) * 100 : 0)
    };
  });
}

function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }

module.exports = { buildReport, listTransactions, projectsSummary, round2, round1 };