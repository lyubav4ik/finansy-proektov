/* Права доступа: роли на портале (глобально для всех проектов) + права на конкретный проект.

   Роли:
   - admin  — полный доступ + управление доступом (владелец установки)
   - full   — создание/редактирование/удаление проектов и операций
   - editor — создание и редактирование, но не удаление
   - viewer — только чтение
   - none   — нет доступа (явно или по умолчанию)

   Доступ может быть назначен конкретному пользователю (portal_roles.user_id /
   project_access.user_id) или целому отделу (access_departments + состав отдела в
   department_members). Прямое назначение на пользователя перекрывает отдел.
*/

const LEVEL = { none: 0, viewer: 1, editor: 2, full: 3, admin: 4 };

const REQUIRED = {
  read: 1,
  create_project: 2,
  edit_project: 2,
  delete_project: 3,
  create_tx: 2,
  edit_tx: 2,
  delete_tx: 3,
  manage_category: 2,
  delete_category: 3,
  manage_employee: 2,
  manage_access: 4
};

function maxRole(rows) {
  let best = null;
  let bestLvl = 0;
  (rows || []).forEach(r => {
    const lvl = LEVEL[r.role] || 0;
    if (lvl > bestLvl) { best = r.role; bestLvl = lvl; }
  });
  return best;
}

/** Роль пользователя на портале, вычисленная с учётом отделов (без учета прав на проект) */
function globalRoleSafe(db, portal, userId) {
  const direct = db.prepare('SELECT role FROM portal_roles WHERE portal = ? AND user_id = ?').get(portal, userId);
  if (direct) return direct.role;
  const dept = db.prepare(
    `SELECT ad.role FROM access_departments ad
     JOIN department_members m ON m.dept_id = ad.dept_id
     WHERE ad.portal = ? AND ad.project_id = 0 AND m.user_id = ?`
  ).all(portal, userId);
  const deptRole = maxRole(dept);
  if (deptRole) return deptRole;
  const subs = db.prepare('SELECT user_id FROM subscriptions WHERE portal = ?').get(portal);
  if (subs && subs.user_id == userId) return 'admin'; // владелец установки — админ
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM portal_roles WHERE portal = ?').get(portal);
  if (!cnt || cnt.c === 0) return 'admin';
  return 'none';
}

/** Роль пользователя на конкретном проекте (переопределяет глобальную), иначе глобальная */
function projectRoleSafe(db, portal, userId, projectId) {
  const direct = db.prepare('SELECT role FROM project_access WHERE portal = ? AND project_id = ? AND user_id = ?')
    .get(portal, projectId, userId);
  if (direct) return direct.role;
  const dept = db.prepare(
    `SELECT ad.role FROM access_departments ad
     JOIN department_members m ON m.dept_id = ad.dept_id
     WHERE ad.portal = ? AND ad.project_id = ? AND m.user_id = ?`
  ).all(portal, projectId, userId);
  return maxRole(dept);
}

function effectiveRole(db, portal, userId, projectId) {
  if (projectId != null) {
    const pr = projectRoleSafe(db, portal, userId, projectId);
    if (pr) return pr;
  }
  return globalRoleSafe(db, portal, userId);
}

function can(db, portal, userId, action, projectId) {
  const need = REQUIRED[action];
  if (!need) return false;
  const role = effectiveRole(db, portal, userId, projectId);
  return (LEVEL[role] || 0) >= need;
}

/** Проекты, доступные пользователю: null означает «все проекты» */
function visibleProjects(db, portal, userId) {
  if (globalRoleSafe(db, portal, userId) !== 'none') return null; // все
  const rows = db.prepare(
    `SELECT project_id FROM project_access WHERE portal = ? AND user_id = ? AND role != 'none'
     UNION
     SELECT ad.project_id FROM access_departments ad
     JOIN department_members m ON m.dept_id = ad.dept_id
     WHERE ad.portal = ? AND m.user_id = ? AND ad.project_id != 0`
  ).all(portal, userId, portal, userId);
  return rows.map(r => r.project_id);
}

/** Роль для /me */
function meRole(db, portal, userId) {
  return globalRoleSafe(db, portal, userId);
}

module.exports = { LEVEL, can, effectiveRole, globalRole: globalRoleSafe, projectRoleSafe, visibleProjects, meRole };