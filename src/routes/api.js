const express = require('express');
const router = express.Router();
const { db, DEFAULT_COLORS } = require('../db');
const { verifyUser, getPortalUsers } = require('../bitrix');
const { buildReport, listTransactions, projectsSummary, round2 } = require('../report');

// ---- Аутентификация: фронтенд присылает домен + токен пользователя ----
async function auth(req, res, next) {
  const portal = req.get('X-Portal');
  const token = req.get('X-Auth-Token');
  if (!portal || !token) {
    return res.status(401).json({ error: 'Требуется авторизация (X-Portal, X-Auth-Token)' });
  }
  try {
    const user = await verifyUser(portal, token);
    if (!user || !user.ID) return res.status(401).json({ error: 'Неверный токен' });
    req.portal = portal;
    req.authToken = token;
    req.user = user;
    next();
  } catch (e) {
    res.status(e.code === 'NO_SUBSCRIPTION' ? 503 : 401).json({ error: e.message });
  }
}

function amount(v) { return round2(parseFloat(v)) || 0; }

// ---- Статус установки ----
router.get('/subscription', (req, res) => {
  const portal = (req.get('X-Portal') || '').toLowerCase();
  const sub = portal ? db.prepare('SELECT portal, created_at, updated_at FROM subscriptions WHERE portal = ?').get(portal) : null;
  if (sub) return res.json({ installed: true, portal: sub.portal });
  res.json({ installed: false });
});

// ---- Текущий пользователь ----
router.get('/me', auth, (req, res) => {
  res.json({
    id: req.user.ID,
    name: req.user.NAME || req.user.LAST_NAME || 'Пользователь',
    fullName: [req.user.NAME, req.user.LAST_NAME].filter(Boolean).join(' '),
    email: req.user.EMAIL || ''
  });
});

// ---- Сотрудники портала для выбора ----
router.get('/portal-users', auth, async (req, res) => {
  try {
    const users = await getPortalUsers(req.portal, req.authToken);
    res.json(users.map(u => ({
      id: u.ID,
      name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' '),
      email: u.EMAIL || ''
    })));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Проекты ----
router.get('/projects', auth, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects WHERE portal = ? ORDER BY created_at DESC').all(req.portal);
  const summary = projectsSummary(req.portal, null, null);
  const byId = Object.fromEntries(summary.map(p => [p.id, p]));
  res.json(projects.map(p => Object.assign(p, byId[p.id] || { income: 0, expense: 0, profit: 0, margin: 0 })));
});

router.post('/projects', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Название проекта обязательно' });
  const color = String(req.body.color || DEFAULT_COLORS[0] || '#FF6B2C');
  const budget = amount(req.body.budget);
  const info = db.prepare('INSERT INTO projects (portal, name, color, budget) VALUES (?,?,?,?)')
    .run(req.portal, name, color, budget);
  res.json({ id: info.lastInsertRowid, name, color, budget });
});

router.patch('/projects/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Проект не найден' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : row.name;
  const color = req.body.color || row.color;
  const budget = req.body.budget !== undefined ? amount(req.body.budget) : row.budget;
  db.prepare('UPDATE projects SET name = ?, color = ?, budget = ? WHERE id = ?').run(name, color, budget, id);
  res.json({ id, name, color, budget });
});

router.delete('/projects/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM projects WHERE id = ? AND portal = ?').run(id, req.portal);
  res.status(204).end();
});

// ---- Статьи ----
router.get('/categories', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM categories WHERE portal = ? ORDER BY is_system DESC, type, name').all(req.portal);
  res.json(rows);
});

router.post('/categories', auth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const type = req.body.type === 'expense' ? 'expense' : 'income';
  if (!name) return res.status(400).json({ error: 'Название статьи обязательно' });
  const info = db.prepare('INSERT INTO categories (portal, name, type) VALUES (?,?,?)').run(req.portal, name, type);
  res.json({ id: info.lastInsertRowid, name, type, is_system: 0 });
});

router.patch('/categories/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM categories WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Статья не найдена' });
  if (row.is_system) return res.status(400).json({ error: 'Системные статьи нельзя редактировать' });
  const name = String(req.body.name || row.name).trim();
  const type = req.body.type ? (req.body.type === 'expense' ? 'expense' : 'income') : row.type;
  db.prepare('UPDATE categories SET name = ?, type = ? WHERE id = ?').run(name, type, id);
  res.json({ id, name, type });
});

router.delete('/categories/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM categories WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Статья не найдена' });
  if (row.is_system) return res.status(400).json({ error: 'Системную статью нельзя удалить' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.status(204).end();
});

// ---- Сотрудники проекта ----
router.get('/employees', auth, (req, res) => {
  const where = ['portal = ?'];
  const params = [req.portal];
  if (req.query.project_id) { where.push('project_id = ?'); params.push(parseInt(req.query.project_id, 10)); }
  const rows = db.prepare(`SELECT * FROM employees WHERE ${where.join(' AND ')} ORDER BY name`).all(...params);
  res.json(rows);
});

router.post('/employees', auth, (req, res) => {
  const projectId = parseInt(req.body.project_id, 10);
  const name = String(req.body.name || '').trim();
  const bitrixUserId = parseInt(req.body.bitrix_user_id || 0, 10) || null;
  const role = String(req.body.role || '').trim();
  if (!projectId || !name) return res.status(400).json({ error: 'Проект и имя обязательны' });
  const proj = db.prepare('SELECT id FROM projects WHERE id = ? AND portal = ?').get(projectId, req.portal);
  if (!proj) return res.status(400).json({ error: 'Проект не найден' });
  const info = db.prepare('INSERT INTO employees (portal, project_id, bitrix_user_id, name, role) VALUES (?,?,?,?,?)')
    .run(req.portal, projectId, bitrixUserId, name, role);
  res.json({ id: info.lastInsertRowid, project_id: projectId, name, role, bitrix_user_id: bitrixUserId });
});

router.delete('/employees/:id', auth, (req, res) => {
  db.prepare('DELETE FROM employees WHERE id = ? AND portal = ?').run(req.params.id, req.portal);
  res.status(204).end();
});

// ---- Транзакции ----
router.get('/transactions', auth, (req, res) => {
  const filters = {
    projectId: req.query.project_id ? parseInt(req.query.project_id, 10) : null,
    categoryId: req.query.category_id ? parseInt(req.query.category_id, 10) : null,
    type: req.query.type,
    dateFrom: req.query.date_from,
    dateTo: req.query.date_to
  };
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  res.json(listTransactions(req.portal, filters, page));
});

router.post('/transactions', auth, (req, res) => {
  const projectId = parseInt(req.body.project_id, 10);
  const categoryId = parseInt(req.body.category_id, 10);
  const type = req.body.type === 'expense' ? 'expense' : 'income';
  const value = amount(req.body.amount);
  if (!projectId || !categoryId) return res.status(400).json({ error: 'Проект и статья обязательны' });
  if (value <= 0) return res.status(400).json({ error: 'Сумма должна быть больше нуля' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : new Date().toISOString().slice(0, 10);
  const comment = String(req.body.comment || '').trim();
  const employeeId = parseInt(req.body.employee_id || 0, 10) || null;
  const info = db.prepare(`INSERT INTO transactions (portal, project_id, category_id, type, amount, date, comment, employee_id)
    VALUES (?,?,?,?,?,?,?,?)`).run(req.portal, projectId, categoryId, type, value, date, comment, employeeId);
  res.json({ id: info.lastInsertRowid, project_id: projectId, category_id: categoryId, type, amount: value, date });
});

router.patch('/transactions/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM transactions WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Операция не найдена' });
  const type = req.body.type ? (req.body.type === 'expense' ? 'expense' : 'income') : row.type;
  const value = req.body.amount !== undefined ? amount(req.body.amount) : row.amount;
  const categoryId = req.body.category_id !== undefined ? parseInt(req.body.category_id, 10) : row.category_id;
  const comment = req.body.comment !== undefined ? String(req.body.comment).trim() : row.comment;
  const employeeId = req.body.employee_id !== undefined ? (parseInt(req.body.employee_id, 10) || null) : row.employee_id;
  const date = req.body.date || row.date;
  db.prepare('UPDATE transactions SET category_id = ?, type = ?, amount = ?, date = ?, comment = ?, employee_id = ? WHERE id = ?')
    .run(categoryId, type, value, date, comment, employeeId, id);
  res.json({ id, type, amount: value, category_id: categoryId, date, comment, employee_id: employeeId });
});

router.delete('/transactions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ? AND portal = ?').run(req.params.id, req.portal);
  res.status(204).end();
});

// ---- Отчёт ----
router.get('/report', auth, (req, res) => {
  const filters = {
    projectId: req.query.project_id ? parseInt(req.query.project_id, 10) : null,
    categoryId: req.query.category_id ? parseInt(req.query.category_id, 10) : null,
    employeeId: req.query.employee_id ? parseInt(req.query.employee_id, 10) : null,
    dateFrom: req.query.date_from,
    dateTo: req.query.date_to
  };
  res.json(buildReport(req.portal, filters));
});

// ---- Экспорт CSV ----
router.get('/export/csv', auth, (req, res) => {
  const filters = {
    projectId: req.query.project_id ? parseInt(req.query.project_id, 10) : null,
    categoryId: req.query.category_id ? parseInt(req.query.category_id, 10) : null,
    type: req.query.type,
    dateFrom: req.query.date_from,
    dateTo: req.query.date_to
  };
  const { items } = listTransactions(req.portal, filters, 1, 100000);
  const header = 'ID;Дата;Тип;Сумма;Проект;Статья;Сотрудник;Комментарий';
  const lines = items.map(t => [
    t.id, t.date, t.type === 'income' ? 'Доход' : 'Расход',
    String(t.amount).replace('.', ','),
    t.project_name, t.category_name, t.employee_name || '', (t.comment || '').replace(/;/g, '')
  ].join(';'));
  const csv = '\uFEFF' + [header, ...lines].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="finansy-proektov.csv"');
  res.send(csv);
});

module.exports = router;