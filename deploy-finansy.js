/* Деплой «Финансы проектов» на Galaxy.
   Использование: $env:VIBE_KEY="vibe_api_..." && node deploy-finansy.js */
const fs = require('fs');
const path = require('path');
const tar = require('tar');

const VIBE_KEY = process.env.VIBE_KEY;
if (!VIBE_KEY) { console.error('VIBE_KEY не задан'); process.exit(1); }
const BASE = 'https://vibecode.bitrix24.tech/v1';
const APP_NAME = 'finansy-proektov';
const META = path.join(__dirname, 'deploy-server.json');

async function api(method, route, body = null, extra = {}) {
  const opts = { method, headers: { 'X-Api-Key': VIBE_KEY, ...extra } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(BASE + route, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = json && (json.error || json.message) ? JSON.stringify(json.error || json.message) : text.slice(0, 300);
    throw new Error(`${method} ${route} → ${res.status}: ${msg}`);
  }
  return (json && json.data !== undefined) ? json.data : json;
}

async function tarBase64() {
  const root = path.join(__dirname, 'src');
  const tarPath = path.join(__dirname, 'src.tar.gz');
  await tar.create(
    { gzip: true, file: tarPath, cwd: root, filter: (p) => !p.startsWith('node_modules') },
    fs.readdirSync(root)
  );
  const b64 = fs.readFileSync(tarPath).toString('base64');
  fs.unlinkSync(tarPath);
  return b64;
}

async function main() {
  // 1. Сервер (используем созданный ранее, если есть)
  let serverId = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')).serverId : null;
  if (!serverId) {
    console.log('Создаю сервер...');
    const srv = await api('POST', '/infra/servers', {
      provider: 'bitrix-cloud',
      name: APP_NAME,
      plan: 'bc-small',
      region: 'ru-central1-b',
      image: 'fd83esfomhq25p2ono90'
    });
    serverId = srv.id;
    fs.writeFileSync(META, JSON.stringify({ serverId, appUrl: srv.appUrl || '' }));
    console.log(`Сервер создан: id=${serverId}, kind=${srv.kind}, appUrl=${srv.appUrl || 'пока нет'}`);
  } else {
    console.log(`Использую существующий сервер: ${serverId}`);
  }

  // 2. Детали (для appUrl при необходимости)
  const detail = await api('GET', `/infra/servers/${serverId}`);
  const appUrl = detail.appUrl || '';
  console.log(`Статус: ${detail.status}, blackholeStatus: ${detail.blackholeStatus}, appUrl: ${appUrl}`);

  // 3. Деплой
  console.log('Пакую код...');
  const content = await tarBase64();
  console.log(`Архив: ${Math.round(content.length / 1024)} KB base64`);
  const deploy = await api('POST', `/infra/servers/${serverId}/deploy`, {
    source: { content },
    runtime: 'node20',
    install: 'cd /opt/app && npm install --omit=dev',
    start: 'cd /opt/app && node server.js',
    port: 3000,
    env: {
      PORT: '3000',
      SERVER_URL: appUrl || '',
      OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID || '',
      OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET || ''
    }
  }, { 'X-Skip-Source-Snapshot': 'deploy from local source' });
  const finalUrl = deploy.appUrl || appUrl;
  console.log(`Деплой: ${deploy.status || deploy.state || 'ok'}, appUrl: ${finalUrl}`);

  // 4. Авто-сон 15 минут (минимальное значение)
  try {
    await api('PATCH', `/infra/servers/${serverId}/sleep`, { sleepAfterMinutes: 15 });
    console.log('Авто-сон: 15 минут ✓');
  } catch (e) { console.log('Авто-сон:', e.message); }

  // 5. Публичный доступ
  try {
    await api('PATCH', `/infra/servers/${serverId}/access-policy`, { accessPolicy: 'PUBLIC' });
    console.log('Access policy: PUBLIC ✓');
  } catch (e) { console.log('Access policy:', e.message); }

  fs.writeFileSync(META, JSON.stringify({ serverId, appUrl: finalUrl }));
  console.log('\nURL приложения:', finalUrl || '<узнать через GET /infra/servers>');
}

main().catch(e => { console.error('ОШИБКА ДЕПЛОЯ:', e.message); process.exit(1); });