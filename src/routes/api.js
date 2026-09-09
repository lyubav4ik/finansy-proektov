const express = require('express');
const router = express.Router();
const { db, DEFAULT_COLORS, globalRole, hasConfiguredRoles } = require('../db');
const { verifyUser, getPortalUsers, getDepartmentUsers, getDepartmentName, getDepartments, bitrixApi } = require('../bitrix');
const logger = require('../logger');
const { buildReport, listTransactions, projectsSummary, round2 } = require('../report');
const access = require('../access');

// ---- Аутентификация: фронтенд присылает домен + токен пользователя ----
async function auth(req, res, next) {
  const portal = req.get('X-Portal');
  const token = req.get('X-Auth-Token');
  if (!portal) {
    return res.status(401).json({ error: 'Требуется авторизация (X-Portal, X-Auth-Token)' });
  }
  // Если пользовательский токен не пришёл — пробуем сохранённый токен установки портала,
  // чтобы приложение не висло, когда BX24.getAuth не дал токен.
  let user;
  if (token) {
    try {
      user = await verifyUser(portal, token);
    } catch (e) {
      if (e.code !== 'expired_token' && e.code !== 'NO_SUBSCRIPTION') logger.warn(`[AUTH] токен пользователя не прошёл: ${e.message}`);
    }
  }
  try {
    if (!user || !user.ID) {
      const sub = db.prepare('SELECT access_token FROM subscriptions WHERE portal = ?').get(portal);
      if (!sub || !sub.access_token) {
        return res.status(503).json({ error: 'Портал не установлен или нет доступа' });
      }
      user = await verifyUser(portal, sub.access_token);
      if (!user || !user.ID) {
        return res.status(401).json({ error: 'Не удалось подтвердить доступ к порталу' });
      }
    }
    req.portal = portal;
    req.authToken = token || db.prepare('SELECT access_token FROM subscriptions WHERE portal = ?').get(portal).access_token;
    req.user = user;
    req.userId = parseInt(user.ID, 10) || 0;
    req.role = access.meRole(db, portal, req.userId);
    req.visible = access.visibleProjects(db, portal, req.userId); // null = все
    logger.info(`[AUTH] ${portal} user=${req.userId} role=${req.role} token=${token ? 'user' : 'saved'}`);
    next();
  } catch (e) {
    res.status(e.code === 'NO_SUBSCRIPTION' ? 503 : 401).json({ error: e.message });
  }
}

// Права на действия (для инлайн-проверок)
const canRead = (req) => req.role !== 'none' || (req.visible && req.visible.length > 0);
const canGlobal = (req, action) => access.can(db, req.portal, req.userId, action);

function requireActions(action) {
  return (req, res, next) => {
    if (!canGlobal(req, action)) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}

function requireProject(action) {
  return function (req, res, next) {
    const id = parseInt(req.params.id, 10);
    if (!access.can(db, req.portal, req.userId, action, id)) {
      return res.status(403).json({ error: 'Недостаточно прав на проект' });
    }
    next();
  };
}

function isProjectVisible(req, projectId) {
  if (req.visible === null) return true;
  return req.visible.includes(projectId);
}

function amount(v) { return round2(parseFloat(v)) || 0; }

// ---- Статус установки ----
router.get('/subscription', (req, res) => {
  const portal = (req.get('X-Portal') || '').toLowerCase();
  const sub = portal ? db.prepare('SELECT portal, created_at, updated_at FROM subscriptions WHERE portal = ?').get(portal) : null;
  if (sub) return res.json({ installed: true, portal: sub.portal });
  res.json({ installed: false });
});

// ---- Определение портала без токена (для случаев, когда BX24 SDK не отвечает) ----
// Если установка на сервере одна — возвращаем её портал, фронтенд войдёт сохранённым токеном.
router.get('/portal', (req, res) => {
  const reqPortal = (req.get('X-Portal') || '').toLowerCase();
  const all = db.prepare('SELECT portal FROM subscriptions ORDER BY updated_at DESC').all();
  if (reqPortal && db.prepare('SELECT 1 AS ok FROM subscriptions WHERE portal = ?').get(reqPortal)) {
    return res.json({ portal: reqPortal });
  }
  if (all.length === 1) return res.json({ portal: all[0].portal });
  if (all.length === 0) return res.json({ portal: null, count: 0 });
  return res.json({ portal: null, count: all.length, multiple: true });
});

// ---- Текущий пользователь ----
router.get('/me', auth, (req, res) => {
  const uid = req.userId;
  // права по проектам (эффективная роль, учитывая project_access)
  const projs = db.prepare('SELECT id FROM projects WHERE portal = ?').all(req.portal).map(p => p.id);
  const projectRoles = {};
  projs.forEach(pid => { projectRoles[pid] = access.effectiveRole(db, req.portal, uid, pid); });
  const role = req.role;
  const level = access.LEVEL[role] || 0;
  const globalPerm = (action) => access.can(db, req.portal, uid, action);
  res.json({
    id: req.user.ID,
    name: req.user.NAME || req.user.LAST_NAME || 'Пользователь',
    fullName: [req.user.NAME, req.user.LAST_NAME].filter(Boolean).join(' '),
    email: req.user.EMAIL || '',
    role: role,
    level: level,
    admin: role === 'admin',
    projectRoles: projectRoles,
    perm: {
      createProject: globalPerm('create_project'),
      editProject: globalPerm('edit_project'),
      deleteProject: globalPerm('delete_project'),
      createTx: globalPerm('create_tx'),
      editTx: globalPerm('edit_tx'),
      deleteTx: globalPerm('delete_tx'),
      manageCategory: globalPerm('manage_category'),
      deleteCategory: globalPerm('delete_category'),
      manageAccess: role === 'admin'
    }
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
  const visible = req.visible;
  const base = 'SELECT * FROM projects WHERE portal = ?';
  if (visible && visible.length === 0) return res.json([]);
  const sql = base + (visible ? ` AND id IN (${visible.map(() => '?').join(',')})` : '') + ' ORDER BY created_at DESC';
  const projects = db.prepare(sql).all(req.portal, ...(visible || []));
  const summary = projectsSummary(req.portal, null, null, visible);
  const byId = Object.fromEntries(summary.map(p => [p.id, p]));
  res.json(projects.map(p => Object.assign(p, byId[p.id] || { income: 0, expense: 0, profit: 0, margin: 0 })));
});

router.post('/projects', auth, requireActions('create_project'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Название проекта обязательно' });
  const color = String(req.body.color || DEFAULT_COLORS[0] || '#FF6B2C');
  const budget = amount(req.body.budget);
  const info = db.prepare('INSERT INTO projects (portal, name, color, budget) VALUES (?,?,?,?)')
    .run(req.portal, name, color, budget);
  res.json({ id: info.lastInsertRowid, name, color, budget });
});

router.patch('/projects/:id', auth, requireProject('edit_project'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM projects WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Проект не найден' });
  const name = req.body.name !== undefined ? String(req.body.name).trim() : row.name;
  const color = req.body.color || row.color;
  const budget = req.body.budget !== undefined ? amount(req.body.budget) : row.budget;
  db.prepare('UPDATE projects SET name = ?, color = ?, budget = ? WHERE id = ?').run(name, color, budget, id);
  res.json({ id, name, color, budget });
});

router.delete('/projects/:id', auth, requireProject('delete_project'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  // каскад вручную (sql.js без включённых foreign_keys)
  db.prepare('DELETE FROM transactions WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM employees WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM project_access WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ? AND portal = ?').run(id, req.portal);
  res.status(204).end();
});

// ---- Статьи ----
router.get('/categories', auth, (req, res) => {
  if (!canRead(req)) return res.status(403).json({ error: 'Нет доступа' });
  const rows = db.prepare('SELECT * FROM categories WHERE portal = ? ORDER BY is_system DESC, type, name').all(req.portal);
  res.json(rows);
});

router.post('/categories', auth, requireActions('manage_category'), (req, res) => {
  const name = String(req.body.name || '').trim();
  const type = req.body.type === 'expense' ? 'expense' : 'income';
  if (!name) return res.status(400).json({ error: 'Название статьи обязательно' });
  const info = db.prepare('INSERT INTO categories (portal, name, type) VALUES (?,?,?)').run(req.portal, name, type);
  res.json({ id: info.lastInsertRowid, name, type, is_system: 0 });
});

router.patch('/categories/:id', auth, requireActions('manage_category'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM categories WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Статья не найдена' });
  if (row.is_system) return res.status(400).json({ error: 'Системные статьи нельзя редактировать' });
  const name = String(req.body.name || row.name).trim();
  const type = req.body.type ? (req.body.type === 'expense' ? 'expense' : 'income') : row.type;
  db.prepare('UPDATE categories SET name = ?, type = ? WHERE id = ?').run(name, type, id);
  res.json({ id, name, type });
});

router.delete('/categories/:id', auth, requireActions('delete_category'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM categories WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Статья не найдена' });
  if (row.is_system) return res.status(400).json({ error: 'Системную статью нельзя удалить' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.status(204).end();
});

// ---- Сотрудники проекта ----
router.get('/employees', auth, (req, res) => {
  if (!canRead(req)) return res.status(403).json({ error: 'Нет доступа' });
  const where = ['portal = ?'];
  const params = [req.portal];
  if (req.query.project_id) {
    const pid = parseInt(req.query.project_id, 10);
    if (!isProjectVisible(req, pid)) return res.status(403).json({ error: 'Нет доступа к проекту' });
    where.push('project_id = ?'); params.push(pid);
  }
  if (req.visible) {
    if (req.visible.length === 0) return res.json([]);
    where.push(`project_id IN (${req.visible.map(() => '?').join(',')})`);
    params.push(...req.visible);
  }
  const rows = db.prepare(`SELECT * FROM employees WHERE ${where.join(' AND ')} ORDER BY name`).all(...params);
  res.json(rows);
});

router.post('/employees', auth, (req, res) => {
  const projectId = parseInt(req.body.project_id, 10);
  if (!access.can(db, req.portal, req.userId, 'edit_project', projectId)) {
    return res.status(403).json({ error: 'Недостаточно прав на проект' });
  }
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
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND portal = ?').get(req.params.id, req.portal);
  if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
  if (!access.can(db, req.portal, req.userId, 'edit_project', emp.project_id)) {
    return res.status(403).json({ error: 'Недостаточно прав на проект' });
  }
  db.prepare('DELETE FROM employees WHERE id = ? AND portal = ?').run(req.params.id, req.portal);
  res.status(204).end();
});

// ---- Транзакции ----
router.get('/transactions', auth, (req, res) => {
  if (!canRead(req)) return res.status(403).json({ error: 'Нет доступа' });
  const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
  if (projectId && !isProjectVisible(req, projectId)) return res.status(403).json({ error: 'Нет доступа к проекту' });
  const filters = {
    projectId,
    projectIds: req.visible,
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
  if (!access.can(db, req.portal, req.userId, 'create_tx', projectId)) {
    return res.status(403).json({ error: 'Недостаточно прав на проект' });
  }
  const categoryId = parseInt(req.body.category_id, 10);
  const type = req.body.type === 'expense' ? 'expense' : 'income';
  const value = amount(req.body.amount);
  if (!projectId || !categoryId) return res.status(400).json({ error: 'Проект и статья обязательны' });
  if (value <= 0) return res.status(400).json({ error: 'Сумма должна быть больше нуля' });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : new Date().toISOString().slice(0, 10);
  const comment = String(req.body.comment || '').trim();
  const employeeId = parseInt(req.body.employee_id || 0, 10) || null;
  const authorName = ([req.user.NAME, req.user.LAST_NAME, req.user.TITLE].filter(Boolean).join(' ') || ('ID ' + req.userId)).trim();
  const info = db.prepare(`INSERT INTO transactions (portal, project_id, category_id, type, amount, date, comment, employee_id, author_id, author_name)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(req.portal, projectId, categoryId, type, value, date, comment, employeeId, req.userId, authorName);
  res.json({ id: info.lastInsertRowid, project_id: projectId, category_id: categoryId, type, amount: value, date, author_name: authorName });
});

router.patch('/transactions/:id', auth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM transactions WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Операция не найдена' });
  if (!access.can(db, req.portal, req.userId, 'edit_tx', row.project_id)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
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
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM transactions WHERE id = ? AND portal = ?').get(id, req.portal);
  if (!row) return res.status(404).json({ error: 'Операция не найдена' });
  if (!access.can(db, req.portal, req.userId, 'delete_tx', row.project_id)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  db.prepare('DELETE FROM transactions WHERE id = ? AND portal = ?').run(req.params.id, req.portal);
  res.status(204).end();
});

// ---- Отчёт ----
router.get('/report', auth, (req, res) => {
  if (!canRead(req)) return res.status(403).json({ error: 'Нет доступа' });
  const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
  if (projectId && !isProjectVisible(req, projectId)) return res.status(403).json({ error: 'Нет доступа к проекту' });
  const filters = {
    projectId,
    projectIds: req.visible,
    categoryId: req.query.category_id ? parseInt(req.query.category_id, 10) : null,
    employeeId: req.query.employee_id ? parseInt(req.query.employee_id, 10) : null,
    dateFrom: req.query.date_from,
    dateTo: req.query.date_to
  };
  res.json(buildReport(req.portal, filters));
});

// ---- Экспорт CSV ----
router.get('/export/csv', auth, (req, res) => {
  if (!canRead(req)) return res.status(403).json({ error: 'Нет доступа' });
  const projectId = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
  if (projectId && !isProjectVisible(req, projectId)) return res.status(403).json({ error: 'Нет доступа к проекту' });
  const filters = {
    projectId,
    projectIds: req.visible,
    categoryId: req.query.category_id ? parseInt(req.query.category_id, 10) : null,
    type: req.query.type,
    dateFrom: req.query.date_from,
    dateTo: req.query.date_to
  };
  const { items } = listTransactions(req.portal, filters, 1, 100000);
  const header = 'ID;Дата;Тип;Сумма;Проект;Статья;Автор;Комментарий';
  const lines = items.map(t => [
    t.id, t.date, t.type === 'income' ? 'Доход' : 'Расход',
    String(t.amount).replace('.', ','),
    t.project_name, t.category_name, t.author_name || '', (t.comment || '').replace(/;/g, '')
  ].join(';'));
  const csv = '\uFEFF' + [header, ...lines].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="finansy-proektov.csv"');
  res.send(csv);
});

// ---- Доступы (только админ) ----
// Хелперы работы с отделами: состав отдела кэшируется в department_members,
// чтобы права считались без лишних запросов к порталу.
function syncDeptMembers(db, portal, deptId, users) {
  db.prepare('DELETE FROM department_members WHERE portal = ? AND dept_id = ?').run(portal, deptId);
  const ins = db.prepare('INSERT OR IGNORE INTO department_members (portal, dept_id, user_id) VALUES (?,?,?)');
  (users || []).forEach(u => {
    const uid = parseInt(u.ID !== undefined ? u.ID : u.id, 10);
    if (uid) ins.run(portal, deptId, uid);
  });
}

async function resolveDept(db, portal, req, deptId) {
  // отдел уже был сохранён — состав переиспользуем
  const existing = db.prepare('SELECT dept_name FROM access_departments WHERE portal = ? AND dept_id = ?').get(portal, deptId);
  let users = [];
  try {
    users = await getDepartmentUsers(portal, deptId, req.authToken);
  } catch (e) {
    logger.warn(`[ACCESS] department.get dept=${deptId}: ${e.message}`);
  }
  syncDeptMembers(db, portal, deptId, users);
  return existing ? existing.dept_name : '';
}

// Получить: выбранные глобальные роли + выбранные права по проектам + отделы
router.get('/access', auth, requireActions('manage_access'), async (req, res) => {
  try {
    // Глобальные роли: только те пользователи, кому роль назначена явно
    const glob = db.prepare('SELECT user_id, role, name FROM portal_roles WHERE portal = ?').all(req.portal);
    const depts = db.prepare("SELECT dept_id, dept_name, role FROM access_departments WHERE portal = ? AND project_id = 0").all(req.portal);
    const projects = db.prepare('SELECT id, name FROM projects WHERE portal = ? ORDER BY created_at DESC').all(req.portal);

    const projWithAccess = projects.map(p => {
      const users = db.prepare('SELECT user_id, role, name FROM project_access WHERE portal = ? AND project_id = ?')
        .all(req.portal, p.id);
      const pdepts = db.prepare('SELECT dept_id, dept_name, role FROM access_departments WHERE portal = ? AND project_id = ?')
        .all(req.portal, p.id);
      return {
        id: p.id,
        name: p.name,
        users: users.map(u => ({ id: u.user_id, name: u.name || 'ID ' + u.user_id, role: u.role })),
        departments: pdepts.map(d => ({ id: d.dept_id, name: d.dept_name || 'Отдел ' + d.dept_id, role: d.role }))
      };
    });

    res.json({
      users: glob.map(u => ({ id: u.user_id, name: u.name || 'ID ' + u.user_id, globalRole: u.role })),
      departments: depts.map(d => ({ id: d.dept_id, name: d.dept_name || 'Отдел ' + d.dept_id, globalRole: d.role })),
      projects: projWithAccess,
      firstTime: !hasConfiguredRoles(req.portal)
    });
  } catch (e) {
    logger.error(`[ACCESS] /api/access failed: ${e && e.message} (code=${e && e.code}) stack=${e && e.stack}`);
    res.status(400).json({ error: (e && e.message) || String(e) });
  }
});

// Глобальные роли (ко всем проектам). grants: [{user_id?, dept_id?, dept_name?, role}]
router.post('/access/batch', auth, requireActions('manage_access'), async (req, res) => {
  const grants = Array.isArray(req.body && req.body.grants) ? req.body.grants : [];
  const allowed = { viewer: 1, editor: 1, full: 1, admin: 1, none: 1 };
  const upsertUser = db.prepare('INSERT INTO portal_roles (portal, user_id, role, name, origin_dept) VALUES (?,?,?,?,NULL) ON CONFLICT (portal, user_id) DO UPDATE SET role = excluded.role, name = excluded.name, origin_dept = NULL');
  const delUser = db.prepare('DELETE FROM portal_roles WHERE portal = ? AND user_id = ?');

  // Сначала убираем старые отделы, которых больше нет в новом списке
  const oldDepts = db.prepare('SELECT dept_id FROM access_departments WHERE portal = ? AND project_id = 0').all(req.portal)
    .map(d => d.dept_id);
  const newDeptIds = new Set(
    grants.filter(g => g.dept_id && g.role !== 'none' && allowed[g.role]).map(g => parseInt(g.dept_id, 10))
  );
  const delDept = db.prepare('DELETE FROM access_departments WHERE portal = ? AND project_id = 0 AND dept_id = ?');
  oldDepts.forEach(d => { if (!newDeptIds.has(d)) { delDept.run(req.portal, d); db.prepare('DELETE FROM department_members WHERE portal = ? AND dept_id = ?').run(req.portal, d); } });

  // Сохраняем отделы (разворачиваем состав)
  const upsertDept = db.prepare('INSERT INTO access_departments (portal, project_id, dept_id, dept_name, role) VALUES (?,0,?,?,?) ON CONFLICT (portal, project_id, dept_id) DO UPDATE SET dept_name = excluded.dept_name, role = excluded.role');
  for (const g of grants) {
    if (g.dept_id && g.role !== 'none' && allowed[g.role]) {
      const deptId = parseInt(g.dept_id, 10);
      const resolvedName = await resolveDept(db, req.portal, req, deptId);
      upsertDept.run(req.portal, deptId, g.dept_name || resolvedName || ('Отдел ' + deptId), g.role);
    }
  }

  // Пользователи: полная замена глобальных ролей
  const kept = grants.filter(g => g.user_id && allowed[g.role]);
  for (const g of kept) {
    if (g.role === 'none') { delUser.run(req.portal, parseInt(g.user_id, 10)); continue; }
    upsertUser.run(req.portal, parseInt(g.user_id, 10), g.role, g.name || '');
  }
  // Удалить роли пользователей, которых больше нет в списке (не отделы)
  const keptIds = new Set(kept.filter(g => g.role !== 'none').map(g => parseInt(g.user_id, 10)));
  const oldUsers = db.prepare('SELECT user_id FROM portal_roles WHERE portal = ? AND origin_dept IS NULL').all(req.portal).map(r => r.user_id);
  const del = db.prepare('DELETE FROM portal_roles WHERE portal = ? AND user_id = ?');
  oldUsers.forEach(uid => { if (!keptIds.has(uid)) del.run(req.portal, uid); });

  // Админа (владельца) не роняем ниже admin
  const sub = db.prepare('SELECT user_id FROM subscriptions WHERE portal = ?').get(req.portal);
  if (sub && sub.user_id) {
    db.prepare('INSERT INTO portal_roles (portal, user_id, role, name, origin_dept) VALUES (?,?,?,?,NULL) ON CONFLICT (portal, user_id) DO UPDATE SET role = \'admin\', origin_dept = NULL')
      .run(req.portal, sub.user_id, 'admin', '');
  }
  res.json({ ok: true });
});

// Права на конкретный проект. body: {project_id, grants:[{user_id?, dept_id?, dept_name?, role}]}
router.post('/access/project', auth, requireActions('manage_access'), async (req, res) => {
  const pid = parseInt(req.body && req.body.project_id, 10);
  const grants = Array.isArray(req.body && req.body.grants) ? req.body.grants : [];
  const allowed = { viewer: 1, editor: 1, full: 1, admin: 1, none: 1 };
  if (!pid) return res.status(400).json({ error: 'project_id обязателен' });
  const proj = db.prepare('SELECT id FROM projects WHERE id = ? AND portal = ?').get(pid, req.portal);
  if (!proj) return res.status(400).json({ error: 'Проект не найден' });

  // Полная замена прав на проект (пользователи + отделы)
  db.prepare('DELETE FROM project_access WHERE portal = ? AND project_id = ?').run(req.portal, pid);
  const oldDepts = db.prepare('SELECT dept_id FROM access_departments WHERE portal = ? AND project_id = ?').all(req.portal, pid).map(d => d.dept_id);
  const newDeptIds = new Set(grants.filter(g => g.dept_id && g.role !== 'none' && allowed[g.role]).map(g => parseInt(g.dept_id, 10)));
  oldDepts.forEach(d => {
    if (!newDeptIds.has(d)) {
      db.prepare('DELETE FROM access_departments WHERE portal = ? AND project_id = ? AND dept_id = ?').run(req.portal, pid, d);
    }
  });

  const upsertUser = db.prepare('INSERT INTO project_access (portal, project_id, user_id, role, name, origin_dept) VALUES (?,?,?,?,?,NULL) ON CONFLICT (portal, project_id, user_id) DO UPDATE SET role = excluded.role, name = excluded.name, origin_dept = NULL');
  for (const g of grants) {
    if (g.dept_id && g.role !== 'none' && allowed[g.role]) {
      const deptId = parseInt(g.dept_id, 10);
      const existingName = db.prepare('SELECT dept_name FROM access_departments WHERE portal = ? AND dept_id = ?').get(req.portal, deptId);
      const name = g.dept_name || (existingName && existingName.dept_name) || (await resolveDept(db, req.portal, req, deptId)) || ('Отдел ' + deptId);
      db.prepare('INSERT INTO access_departments (portal, project_id, dept_id, dept_name, role) VALUES (?,?,?,?,?) ON CONFLICT (portal, project_id, dept_id) DO UPDATE SET dept_name = excluded.dept_name, role = excluded.role')
        .run(req.portal, pid, deptId, name, g.role);
      try {
        const users = await getDepartmentUsers(req.portal, deptId, req.authToken);
        syncDeptMembers(db, req.portal, deptId, users);
      } catch (e) {
        logger.warn(`[ACCESS] department.get dept=${deptId}: ${e.message}`);
      }
    } else if (g.user_id) {
      const uid = parseInt(g.user_id, 10);
      if (g.role === 'none' || !allowed[g.role]) continue;
      upsertUser.run(req.portal, pid, uid, g.role, g.name || '');
    }
  }
  res.json({ ok: true });
});

// Список отделов портала для фронта
router.get('/departments', auth, requireActions('manage_access'), async (req, res) => {
  try {
    const list = await getDepartments(req.portal, req.authToken);
    res.json({ departments: list.map(d => ({ id: d.ID, name: d.NAME })) });
  } catch (e) {
    logger.warn(`[ACCESS] department.get all: ${e.message}`);
    res.json({ departments: [] });
  }
});

// Имена выбранных пользователей и отделов (после BX24.userFieldSelector)
router.post('/access/names', auth, requireActions('manage_access'), async (req, res) => {
  try {
    const uids = Array.isArray(req.body && req.body.user_ids) ? req.body.user_ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    const depts = Array.isArray(req.body && req.body.dept_ids) ? req.body.dept_ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    const users = [];
    const departments = [];
    for (const uid of uids) {
      try {
        const u = await bitrixApi(req.portal, 'user.get', { ID: uid }, { auth: req.authToken });
        const found = Array.isArray(u) ? u[0] : null;
        if (found) users.push({ id: uid, name: [found.NAME, found.LAST_NAME].filter(Boolean).join(' ') || ('ID ' + uid) });
        else users.push({ id: uid, name: 'ID ' + uid });
      } catch (e) {
        users.push({ id: uid, name: 'ID ' + uid });
      }
    }
    for (const dept of depts) {
      let name = 'Отдел ' + dept;
      try {
        const dn = await getDepartmentName(req.portal, dept, req.authToken);
        if (dn) name = dn;
      } catch (e) { /* оставляем fallback */ }
      departments.push({ id: dept, name });
    }
    res.json({ users, departments });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;