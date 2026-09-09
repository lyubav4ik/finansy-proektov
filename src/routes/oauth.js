const express = require('express');
const router = express.Router();
const { db, ensureSystemCategories, grantAdmin } = require('../db');
const logger = require('../logger');
const { bitrixApi } = require('../bitrix');

function installPage(title, bodyHtml, extraScript = '') {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Финансы проектов</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap" rel="stylesheet">
<script src="//api.bitrix24.com/api/v1/"></script>
<style>
  :root {
    --fox-orange:#FF6B2C; --fox-orange-dark:#E85D20; --fox-orange-light:#FF8A2B;
    --fox-gradient:linear-gradient(135deg,#FF6B2C,#FF8A2B);
    --fox-bg-page:#FDF6ED; --fox-glass-bg:rgba(255,255,255,.6); --fox-glass-border:rgba(255,255,255,.8);
    --fox-text-primary:#3D2210; --fox-text-secondary:#A0806A; --fox-text-accent:#C2410C; --fox-text-heading:#7C2D12;
    --fox-shadow-sm:0 2px 12px rgba(194,65,12,.08); --fox-shadow-md:0 6px 20px rgba(194,65,12,.14);
    --fox-shadow-btn:0 2px 6px rgba(247,122,28,.35); --fox-radius-md:12px; --fox-radius-lg:14px;
    --fox-font-sans:'Inter',-apple-system,'Segoe UI',Arial,sans-serif; --fox-font-heading:'Plus Jakarta Sans','Inter',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--fox-font-sans);color:var(--fox-text-primary);background:var(--fox-bg-page);min-height:100vh;
    display:flex;align-items:center;justify-content:center;padding:20px;
    background-image:radial-gradient(circle,rgba(255,107,44,.12) 0,transparent 70%)}
  .card{background:var(--fox-glass-bg);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
    border:1px solid var(--fox-glass-border);border-radius:var(--fox-radius-lg);box-shadow:var(--fox-shadow-sm);
    padding:36px 32px;max-width:480px;text-align:center}
  h1{font-family:var(--fox-font-heading);font-size:26px;margin:0 0 10px;color:var(--fox-text-heading)}
  p{font-size:15px;line-height:1.6;color:var(--fox-text-secondary);margin:8px 0}
  p b{color:var(--fox-text-primary)}
  .btn{display:inline-block;margin-top:18px;padding:13px 30px;border-radius:var(--fox-radius-md);
    background:var(--fox-gradient);color:#fff;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer;
    border:none;box-shadow:var(--fox-shadow-btn);transition:transform .15s ease,box-shadow .2s ease}
  .btn:hover{transform:translateY(-2px);box-shadow:var(--fox-shadow-md)}
  .pico{width:64px;height:64px;object-fit:contain;border-radius:14px;margin:0 auto 18px;display:block;
    box-shadow:0 4px 14px rgba(194,65,12,.18)}
</style></head>
<body><div class="card">
  <img class="pico" src="/icon.png" alt="Финансы проектов">
  <h1>${title}</h1>
  ${bodyHtml}
</div>${extraScript}</body></html>`;
}

// Установка: Битрикс24 шлёт токены на /oauth (POST или GET)
async function handleOAuth(req, res) {
  const params = { ...req.query, ...req.body };

  // Событие ONAPPUSERREADY: приходит после установки и даёт долгоживущую
  // авторизацию системного пользователя (data.*) + авторизацию установщика (auth.*)
  const event = params.event || '';
  if (event === 'ONAPPUSERREADY') {
    return handleAppUserReady(params, res);
  }

  const domain = params.DOMAIN || params.domain || '';
  const userToken = params.AUTH_ID || params.auth_id || '';
  const refreshToken = params.REFRESH_ID || params.refresh_id || '';
  const clientEndpoint = (params.CLIENT_ENDPOINT || params.SERVER_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const memberId = params.member_id || '';
  const userId = parseInt(params.USER_ID || params.user_id, 10) || 1;

  if (!domain) {
    return res.redirect('/');
  }

  // Определяем REST-эндпоинт портала.
  // VibeCode (и некоторые другие платформы) при установке присылают SERVER_ENDPOINT
  // (сервер авторизации oauth.bitrix24.tech/rest) вместо CLIENT_ENDPOINT портала.
  // Если clientEndpoint указывает на oauth-сервер авторизации — подменяем на <домен>/rest.
  const endpoint = (clientEndpoint && !/^(oauth|auth)\./i.test(clientEndpoint))
    ? clientEndpoint
    : domain + '/rest';

  db.prepare(`
    INSERT INTO subscriptions (portal, user_id, access_token, refresh_token, client_endpoint, member_id, updated_at)
    VALUES (?,?,?,?,?,?,unixepoch())
    ON CONFLICT (portal) DO UPDATE SET
      user_id = excluded.user_id,
      access_token = CASE WHEN excluded.access_token != '' THEN excluded.access_token ELSE subscriptions.access_token END,
      refresh_token = CASE WHEN excluded.refresh_token != '' THEN excluded.refresh_token ELSE subscriptions.refresh_token END,
      client_endpoint = excluded.client_endpoint,
      member_id = excluded.member_id,
      updated_at = unixepoch()
  `).run(domain, userId, userToken, refreshToken, endpoint, memberId);

  ensureSystemCategories(domain);
  logger.info(`[OAUTH] установка портала ${domain}, user=${userId}, AUTH_ID=${userToken ? 'есть' : 'нет'}, REFRESH_ID=${refreshToken ? 'есть' : 'нет'}, endpoint=${endpoint}`);

  // Определяем реальный ID установщика через user.current (VibeCode может слать USER_ID
  // системного пользователя или другой ID) и сразу выдаём ему права админа.
  let adminId = userId;
  try {
    const me = await bitrixApi(domain, 'user.current', {}, { auth: userToken });
    if (me && me.ID) {
      adminId = parseInt(me.ID, 10);
      try { db.prepare('UPDATE subscriptions SET user_id = ? WHERE portal = ?').run(adminId, domain); } catch (e) {}
    }
  } catch (e) {
    logger.warn(`[OAUTH] не удалось определить установщика: ${e.message}`);
  }
  grantAdmin(domain, adminId);
  logger.info(`[OAUTH] админ установки: ${adminId} (заявленный ${userId})`);

  const autoOpenScript = `
  <script>
    function finish() {
      if (window.BX24) {
        try { BX24.installFinish(); } catch (e) {}
        // Платформа сама закроет мастер установки; страховка — переход в интерфейс
        setTimeout(function () { window.location.replace('/'); }, 1500);
        return;
      }
      window.location.replace('/');
    }
    window.addEventListener('load', function () { setTimeout(finish, 150); });
  </script>`;

  res.send(installPage('Приложение установлено', `
    <p>«Финансы проектов» подключены к порталу <b>${domain}</b>.</p>
    <p>Открываем приложение…</p>
    <noscript><p>Включите JavaScript и <a href="/">откройте приложение</a>.</p></noscript>
  `, autoOpenScript));
}

// Событие ONAPPUSERREADY: Битрикс24 уведомляет, что создал системного пользователя приложения.
// Приходит POST-ом form-encoded. Определяем реальный портал по client_endpoint и сохраняем
// долгоживущую авторизацию системного пользователя (data.*) как запасную.
function handleAppUserReady(params, res) {
  function parse(o) { try { return typeof o === 'string' ? JSON.parse(o) : (o || {}); } catch (e) { return {}; } }
  const data = parse(params.data);
  const auth = parse(params.auth);

  const endpointRaw = data.client_endpoint || auth.client_endpoint || params.CLIENT_ENDPOINT || '';
  const domain = String(endpointRaw)
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .toLowerCase();
  const memberId = data.member_id || auth.member_id || '';
  const systemToken = data.access_token || '';
  const systemRefresh = data.refresh_token || '';
  const systemUserId = parseInt(data.user_id, 10) || 0;

  // Возможно событие пришло, а установка через обычный поток ещё не сохранилась — запишем базовую запись
  if (domain && domain !== 'oauth.bitrix.info' && domain.indexOf('.') !== -1) {
    const endpointRawClean = String(endpointRaw).replace(/^https?:\/\//, '').replace(/\/$/, '');
    // Та же нормализация: oauth-сервер авторизации подменяем на <домен>/rest
    const endpoint = (endpointRawClean && !/^(oauth|auth)\./i.test(endpointRawClean) && domain)
      ? endpointRawClean
      : domain + '/rest';
    const existing = db.prepare('SELECT refresh_token, access_token FROM subscriptions WHERE portal = ?').get(domain);
    const keepRefresh = existing && existing.refresh_token && !systemRefresh ? existing.refresh_token : (systemRefresh || '');
    const keepAccess = existing && existing.access_token && !systemToken ? existing.access_token : (systemToken || '');
    db.prepare(`
      INSERT INTO subscriptions (portal, user_id, access_token, refresh_token, client_endpoint, member_id, updated_at)
      VALUES (?,?,?,?,?,?,unixepoch())
      ON CONFLICT (portal) DO UPDATE SET
        access_token = CASE WHEN excluded.access_token != '' THEN excluded.access_token ELSE subscriptions.access_token END,
        refresh_token = CASE WHEN excluded.refresh_token != '' THEN excluded.refresh_token ELSE subscriptions.refresh_token END,
        client_endpoint = excluded.client_endpoint,
        member_id = CASE WHEN excluded.member_id != '' THEN excluded.member_id ELSE subscriptions.member_id END,
        updated_at = unixepoch()
    `).run(domain, systemUserId || 1, keepAccess, keepRefresh, endpoint, memberId);
    ensureSystemCategories(domain);
    if (systemUserId) grantAdmin(domain, systemUserId);
    logger.info(`[ONAPPUSERREADY] портал ${domain}, системный пользователь=${systemUserId}, system_access=${systemToken ? 'есть' : 'нет'}, system_refresh=${systemRefresh ? 'есть' : 'нет'}, member=${memberId}`);
  } else {
    logger.warn(`[ONAPPUSERREADY] не удалось определить портал: endpoint=${endpointRaw}, domain=${domain}`);
  }
  res.status(200).end();
}

router.all('/oauth', handleOAuth);
router.post('/', (req, res, next) => {
  const p = { ...req.query, ...req.body };
  if (p.DOMAIN || p.domain) return handleOAuth(req, res);
  next();
});

// HEAD-проверки handler (Битрикс24 пингует при установке/удалении)
router.head('/install', (req, res) => res.status(200).end());
router.head('/uninstall', (req, res) => res.status(200).end());

// Удаление приложения
router.post('/uninstall', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const domain = params.DOMAIN || params.domain || '';
  if (domain) {
    db.prepare('DELETE FROM subscriptions WHERE portal = ?').run(domain);
    db.prepare('DELETE FROM projects WHERE portal = ?').run(domain);
    db.prepare('DELETE FROM categories WHERE portal = ?').run(domain);
    db.prepare('DELETE FROM employees WHERE portal = ?').run(domain);
    db.prepare('DELETE FROM transactions WHERE portal = ?').run(domain);
    console.log(`[UNINSTALL] портал ${domain} удалён`);
    logger.info(`[UNINSTALL] портал ${domain} удалён`);
  }
  res.status(200).end();
});

router.get('/install', (req, res) => {
  res.send(installPage('Финансы проектов', '<p>Приложение устанавливается в ваш Битрикс24. Ожидайте…</p>'));
});

module.exports = router;