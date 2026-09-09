const { db } = require('./db');
const proto = require('./config').b24Protocol;

// Список баз REST-эндпоинтов для портала: сохранённый + стандартный по домену портала.
// Некоторые платформы (VibeCode) при установке якобы передают CLIENT_ENDPOINT сервера
// авторизации (oauth.bitrix24.tech/rest), а не портала — такие endpoint'ы не работают.
function endpointCandidates(sub) {
  const list = [];
  if (sub.client_endpoint) list.push(sub.client_endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, ''));
  if (sub.portal) list.push(sub.portal.replace(/^https?:\/\//, '').replace(/\/+$/, '') + '/rest');
  return Array.from(new Set(list));
}

/**
 * REST-запрос к порталу Битрикс24.
 * @param {string} portal домен портала
 * @param {string} method метод REST (например user.current)
 * @param {object} params параметры
 * @param {object} opts { auth } — пользовательский токен (AUTH_ID) из запроса, иначе сохранённый
 */
async function bitrixApi(portal, method, params = {}, opts = {}) {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE portal = ?').get(portal);
  if (!sub) throw Object.assign(new Error('Портал не установлен'), { code: 'NO_SUBSCRIPTION' });

  const path = method.startsWith('/') ? method : '/' + method;

  async function call(token, endpointBase) {
    const res = await fetch(`${proto}://${endpointBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ auth: token }, params))
    });
    return res.json();
  }

  // Пробуем по очереди: сохранённый endpoint, затем стандартный https://<портал>/rest/
  async function callWithEndpoints(token) {
    let lastErr = null;
    const candidates = endpointCandidates(sub);
    for (const base of candidates) {
      try {
        const d = await call(token, base);
        if (d && d.error && (d.error === 'expired_token' || d.error === 'NO_APPLICATION_TOKEN')) {
          // ошибка авторизации ≠ кривой endpoint — вернуть как есть
          return d;
        }
        if (d && d.error) {
          // Method not found / 404 по этому base — пробуем следующий
          lastErr = d;
          continue;
        }
        // успешный ответ через этот endpoint — запоминаем как рабочий
        if (base !== sub.client_endpoint) {
          db.prepare('UPDATE subscriptions SET client_endpoint = ? WHERE portal = ?').run(base, portal);
        }
        return d;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr && lastErr.error) return lastErr;
    throw lastErr || new Error('Ошибка соединения с порталом');
  }

  const token = opts.auth || sub.access_token;
  const data = await callWithEndpoints(token);

  if (data.error === 'expired_token' && sub.refresh_token && !opts.auth) {
    await refreshToken(sub);
    const updated = db.prepare('SELECT * FROM subscriptions WHERE portal = ?').get(portal);
    const retry = await callWithEndpoints(updated.access_token);
    if (retry.error) throw Object.assign(new Error(retry.error_description || retry.error), { code: retry.error, raw: retry });
    return retry.result;
  }

  if (data.error) throw Object.assign(new Error(data.error_description || data.error), { code: data.error, raw: data });
  return data.result;
}

async function refreshToken(sub) {
  const cfg = require('./config');
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: sub.refresh_token
  });
  const res = await fetch('https://oauth.bitrix.info/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const json = await res.json();
  if (!json.access_token) throw new Error('Не удалось обновить токен: ' + JSON.stringify(json));
  db.prepare('UPDATE subscriptions SET access_token = ?, refresh_token = ?, updated_at = unixepoch() WHERE portal = ?')
    .run(json.access_token, json.refresh_token || sub.refresh_token, sub.portal);
}

/** Проверить токен пользователя и вернуть его данные */
async function verifyUser(portal, userToken) {
  return bitrixApi(portal, 'user.current', {}, { auth: userToken });
}

/** Получить пользователей портала для выбора сотрудников */
async function getPortalUsers(portal, userToken) {
  const users = [];
  let start = 0;
  for (let i = 0; i < 10; i++) { // предохранитель от бесконечного цикла
    let data;
    try {
      data = await bitrixApi(portal, 'user.get', { start }, { auth: userToken });
    } catch (e) {
      require('./logger').warn(`[PORTAL-USERS] user.get failed: ${e.message} (code=${e.code})`);
      break; // не роняем всё приложение из-за списка пользователей
    }
    if (i === 0) require('./logger').warn(`[PORTAL-USERS] user.get first page: ${JSON.stringify(data).slice(0, 200)}`);
    if (!Array.isArray(data) || data.length === 0) break;
    users.push(...data);
    if (data.length < 50) break;
    start += 50;
  }
  return users;
}

/** Сотрудники отдела Битрикс24 (user.get с фильтром UF_DEPARTMENT) */
async function getDepartmentUsers(portal, deptId, userToken) {
  const users = [];
  let start = 0;
  for (let i = 0; i < 20; i++) {
    let data;
    try {
      data = await bitrixApi(portal, 'user.get', { UF_DEPARTMENT: deptId, start }, { auth: userToken });
    } catch (e) {
      require('./logger').warn(`[DEPT-USERS] user.get dept=${deptId} failed: ${e.message} (code=${e.code})`);
      break;
    }
    if (!Array.isArray(data) || data.length === 0) break;
    users.push(...data);
    if (data.length < 50) break;
    start += 50;
  }
  return users;
}

/** Название отдела по ID (department.get c фильтром ID) */
async function getDepartmentName(portal, deptId, userToken) {
  const data = await bitrixApi(portal, 'department.get', { ID: deptId }, { auth: userToken });
  if (Array.isArray(data) && data[0] && data[0].NAME) return data[0].NAME;
  return '';
}

/** Все отделы портала (для штатного выбора) */
async function getDepartments(portal, userToken) {
  const data = await bitrixApi(portal, 'department.get', {}, { auth: userToken });
  if (!Array.isArray(data)) return [];
  return data;
}

module.exports = { bitrixApi, refreshToken, verifyUser, getPortalUsers, getDepartmentUsers, getDepartmentName, getDepartments };