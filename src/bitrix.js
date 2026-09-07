const { db } = require('./db');
const proto = require('./config').b24Protocol;

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

  async function call(token) {
    const path = method.startsWith('/') ? method : '/' + method;
    const res = await fetch(`${proto}://${sub.client_endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ auth: token }, params))
    });
    return res.json();
  }

  const token = opts.auth || sub.access_token;
  const data = await call(token);

  if (data.error === 'expired_token' && sub.refresh_token && !opts.auth) {
    await refreshToken(sub);
    const updated = db.prepare('SELECT * FROM subscriptions WHERE portal = ?').get(portal);
    return call(updated.access_token).then(d => {
      if (d.error) throw Object.assign(new Error(d.error_description || d.error), { code: d.error, raw: d });
      return d.result;
    });
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
    const data = await bitrixApi(portal, 'user.get', { start, FILTER: { USER_TYPE: 'employee' } }, { auth: userToken });
    users.push(...(Array.isArray(data) ? data : []));
    if (data.length < 50) break;
    start += 50;
  }
  return users;
}

module.exports = { bitrixApi, refreshToken, verifyUser, getPortalUsers };