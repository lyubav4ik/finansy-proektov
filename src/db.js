const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const config = require('./config');
const dbFile = config.dbPath;

if (!fs.existsSync(path.dirname(dbFile))) fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subscriptions (
    portal TEXT PRIMARY KEY,
    user_id INTEGER,
    access_token TEXT,
    refresh_token TEXT,
    client_endpoint TEXT,
    member_id TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portal TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#FF6B2C',
    budget REAL DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portal TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    is_system INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portal TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    bitrix_user_id INTEGER,
    name TEXT NOT NULL,
    role TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    portal TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    comment TEXT DEFAULT '',
    employee_id INTEGER,
    author_id INTEGER,
    author_name TEXT DEFAULT '',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories (id),
    FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tx_project ON transactions (project_id);
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date);
  CREATE INDEX IF NOT EXISTS idx_tx_portal ON transactions (portal);
  CREATE INDEX IF NOT EXISTS idx_cat_portal ON categories (portal);
  CREATE INDEX IF NOT EXISTS idx_proj_portal ON projects (portal);
  CREATE TABLE IF NOT EXISTS portal_roles (
    portal TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','full','editor','viewer')),
    name TEXT DEFAULT '',
    origin_dept INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (portal, user_id)
  );
  CREATE TABLE IF NOT EXISTS project_access (
    portal TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','full','editor','viewer')),
    name TEXT DEFAULT '',
    origin_dept INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (portal, project_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS access_departments (
    portal TEXT NOT NULL,
    project_id INTEGER NOT NULL DEFAULT 0,
    dept_id INTEGER NOT NULL,
    dept_name TEXT DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin','full','editor','viewer')),
    created_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (portal, project_id, dept_id)
  );
  CREATE TABLE IF NOT EXISTS department_members (
    portal TEXT NOT NULL,
    dept_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (portal, dept_id, user_id)
  );
`;

const SYSTEM_CATEGORIES = [
  { name: 'Выручка', type: 'income' },
  { name: 'Внешние программисты', type: 'expense' },
  { name: 'Внутренние программисты', type: 'expense' },
  { name: 'Расходы на ИИ', type: 'expense' },
  { name: 'Аренда сервера', type: 'expense' },
  { name: 'Дивиденды', type: 'expense' }
];

const DEFAULT_COLORS = ['#FF6B2C', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1'];

let raw; // sql.js Database (устанавливается в initDatabase)
let saveTimer = null;

function persist() {
  if (!raw) return;
  try {
    const data = Buffer.from(raw.export());
    const tmp = dbFile + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dbFile);
  } catch (e) { console.error('[DB] ошибка сохранения:', e.message); }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 120);
}

function makeStatement(sqlText) {
  const execStmt = (fn) => {
    const stmt = raw.prepare(sqlText);
    try { return fn(stmt); } finally { if (!stmt.freeCalled) stmt.free(); }
  };
  return {
    run(...params) {
      const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      execStmt(stmt => stmt.run(flat));
      scheduleSave();
      const idRows = raw.exec('SELECT last_insert_rowid() AS id');
      return { lastInsertRowid: idRows.length ? idRows[0].values[0][0] : 0, changes: raw.getRowsModified() };
    },
    get(...params) {
      const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return execStmt((stmt) => {
        stmt.bind(flat);
        if (!stmt.step()) return undefined;
        const names = stmt.getColumnNames();
        const values = stmt.get();
        const row = {};
        names.forEach((n, i) => { row[n] = values[i]; });
        return row;
      });
    },
    all(...params) {
      const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      return execStmt((stmt) => {
        stmt.bind(flat);
        const rows = [];
        while (stmt.step()) {
          const names = stmt.getColumnNames();
          const values = stmt.get();
          const o = {};
          names.forEach((n, i) => { o[n] = values[i]; });
          rows.push(o);
        }
        return rows;
      });
    }
  };
}

/** Объект БД с API как у better-sqlite3. Модули требуют его сразу — методы читают актуальный raw. */
const db = {
  prepare: (sql) => makeStatement(sql),
  exec: (sql) => { raw.exec(sql); scheduleSave(); },
  pragma: () => {},
  close: () => { if (saveTimer) clearTimeout(saveTimer); persist(); }
};

/** Инициализация: промис, чтобы все модули, требующие db, могли не ждать */
let initPromise = null;
function initDatabase() {
  if (!initPromise) {
    initPromise = initSqlJs()
      .then((SQL) => {
        if (fs.existsSync(dbFile)) {
          raw = new SQL.Database(fs.readFileSync(dbFile));
        } else {
          raw = new SQL.Database();
          raw.exec('PRAGMA journal_mode = WAL;');
        }
        raw.exec(SCHEMA);
        // миграция: колонки автора для старых таблиц
        try { raw.exec('ALTER TABLE transactions ADD COLUMN author_id INTEGER'); } catch (e) { /* уже есть */ }
        try { raw.exec("ALTER TABLE transactions ADD COLUMN author_name TEXT DEFAULT ''"); } catch (e) { /* уже есть */ }
        try { raw.exec("ALTER TABLE portal_roles ADD COLUMN name TEXT DEFAULT ''"); } catch (e) { /* уже есть */ }
        try { raw.exec('ALTER TABLE portal_roles ADD COLUMN origin_dept INTEGER'); } catch (e) { /* уже есть */ }
        try { raw.exec("ALTER TABLE project_access ADD COLUMN name TEXT DEFAULT ''"); } catch (e) { /* уже есть */ }
        try { raw.exec('ALTER TABLE project_access ADD COLUMN origin_dept INTEGER'); } catch (e) { /* уже есть */ }
        persist();
        console.log('[DB] инициализирована:', dbFile);
      });
  }
  return initPromise;
}

function ensureSystemCategories(portal) {
  if (!raw) return;
  const find = db.prepare('SELECT id FROM categories WHERE portal = ? AND name = ? AND type = ?');
  const insert = db.prepare('INSERT INTO categories (portal, name, type, is_system) VALUES (?, ?, ?, 1)');
  SYSTEM_CATEGORIES.forEach(c => {
    if (!find.get(portal, c.name, c.type)) insert.run(portal, c.name, c.type);
  });
}

/** Выдать/подтвердить роль администратора (владелец установки) */
function grantAdmin(portal, userId) {
  if (!raw || !portal || !userId) return;
  db.prepare('INSERT OR IGNORE INTO portal_roles (portal, user_id, role) VALUES (?,?,?)').run(portal, userId, 'admin');
}

/** Роль пользователя на портале (без права на проект). Возвращает роль или 'none' */
function globalRole(portal, userId) {
  const row = db.prepare('SELECT role FROM portal_roles WHERE portal = ? AND user_id = ?').get(portal, userId);
  return row ? row.role : 'none';
}

/** Есть ли вообще настроенные роли на портале (кроме админа-владельца) */
function hasConfiguredRoles(portal) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM portal_roles WHERE portal = ?').get(portal);
  return (row && row.c) > 0;
}

module.exports = { db, initDatabase, SYSTEM_CATEGORIES, DEFAULT_COLORS, ensureSystemCategories, grantAdmin, globalRole, hasConfiguredRoles };