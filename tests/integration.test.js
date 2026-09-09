const http = require('http');
const { spawn } = require('child_process');

const PORT = 3100;
const MOCK_PORT = 3999;

// Мок-портал Битрикс24
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const isToken7 = body.includes('token7');
    if (req.url.includes('user.current')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: isToken7
        ? { ID: 7, NAME: 'Анна', LAST_NAME: 'Сидорова', EMAIL: 'a@s.ru' }
        : { ID: 42, NAME: 'Тест', LAST_NAME: 'Петров', EMAIL: 'test@test.ru' } }));
    } else if (req.url.includes('user.get')) {
      let result = [
        { ID: 42, NAME: 'Тест', LAST_NAME: 'Петров', EMAIL: 't@t.ru' },
        { ID: 7, NAME: 'Анна', LAST_NAME: 'Сидорова', EMAIL: 'a@s.ru', UF_DEPARTMENT: [1] }
      ];
      if (body.includes('UF_DEPARTMENT')) result = result.filter(u => (u.UF_DEPARTMENT || []).includes(1));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result }));
    } else if (req.url.includes('department.get')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: [{ ID: 1, NAME: 'Разработка' }] }));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: [] }));
    }
  });
});

async function req(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {}, { 'Content-Type': 'application/json' });
  return fetch(`http://localhost:${PORT}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(async r => {
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  });
}

let server;

async function main() {
  const fs = require('fs');
  const path = require('path');
  const integDb = path.join(__dirname, '..', 'tmp_test', 'integ.db');
  if (fs.existsSync(integDb)) fs.unlinkSync(integDb);

  await new Promise(r => mock.listen(MOCK_PORT, r));
  console.log('▶ Мок-портал поднят на', MOCK_PORT);

  server = spawn('node', ['server.js'], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      DB_PATH: integDb,
      B24_PROTOCOL: 'http',
      SERVER_URL: `http://localhost:${PORT}`,
      OAUTH_CLIENT_ID: 'test',
      OAUTH_CLIENT_SECRET: 'test'
    }),
    cwd: require('path').join(__dirname, '..', 'src'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.pipe(process.stdout);
  server.stderr.pipe(process.stderr);

  await new Promise(r => setTimeout(r, 2500));

  // 1. Установка через OAuth
  const auth = await req('/oauth?DOMAIN=integportal.ru&AUTH_ID=abc123&REFRESH_ID=refr337&CLIENT_ENDPOINT=localhost:3999&MEMBER_ID=m1&USER_ID=42');
  console.log('\n1. OAuth-установка →', auth.status);
  if (auth.status !== 200) throw new Error('OAuth не 200');

  const sub = await req('/api/subscription', { headers: { 'X-Portal': 'integportal.ru' } });
  console.log('   Статус установки →', JSON.stringify(sub.json));
  if (!sub.json.installed) throw new Error('Портал не установлен');

  // 2. Авторизация (me)
  const H = { 'X-Portal': 'integportal.ru', 'X-Auth-Token': 'abc123' };
  const me = await req('/api/me', { headers: H });
  console.log('\n2. /api/me →', me.status, JSON.stringify(me.json));
  if (me.json.id !== 42) throw new Error('me не то');

  // 3. Системные статьи
  const cats = await req('/api/categories', { headers: H });
  console.log('\n3. Статьи →', cats.status, cats.json.length, 'статей');
  if (cats.json.length !== 6) throw new Error('Не 6 статей');

  // 4. Создание проекта
  const proj = await req('/api/projects', { method: 'POST', headers: H, body: { name: 'Лендинг', budget: 50000 } });
  console.log('\n4. Проект →', proj.status, JSON.stringify(proj.json));
  const pid = proj.json.id;
  if (!pid) throw new Error('Нет id проекта');

  // 4b. Доступы (админ)
  const acc = await req('/api/access', { headers: H });
  console.log('\n4b. Доступы →', acc.status, 'пользователей:', (acc.json.users || []).length);
  if (acc.status !== 200) throw new Error('/api/access не 200');
  if (!(acc.json.users || []).some(u => String(u.id) === '42')) throw new Error('нет текущего админа в списке');

  // 4c. Глобальная роль отделу 1 (full) — его сотрудники получают роль
  const bch = await req('/api/access/batch', { method: 'POST', headers: H, body: { grants: [{ dept_id: 1, dept_name: 'Разработка', role: 'full' }] } });
  console.log('4c. Batch глобальных ролей →', bch.status, JSON.stringify(bch.json));
  if (bch.status !== 200) throw new Error('/api/access/batch не 200');
  const acc2 = await req('/api/access', { headers: H });
  const deptFound = (acc2.json.departments || []).some(d => String(d.id) === '1' && d.globalRole === 'full');
  if (!deptFound) throw new Error('отдел 1 не сохранился в глобальных ролях');

  // роль отдела применяется к сотруднику отдела (Анна, user 7 — в отделе 1)
  const me7 = await req('/api/me', { headers: { 'X-Portal': 'integportal.ru', 'X-Auth-Token': 'token7' } });
  console.log('4c2. Роль пользователя 7 (через отдел) →', JSON.stringify(me7.json.role));
  if (me7.json.role !== 'full') throw new Error('роль отдела не применилась к пользователю: ' + me7.json.role);

  // 4d. Права на проект через новый формат (grants массивом)
  const prAcc = await req('/api/access/project', { method: 'POST', headers: H, body: { project_id: pid, grants: [{ user_id: 7, name: 'Анна Сидорова', role: 'editor' }] } });
  console.log('4d. Права на проект →', prAcc.status, JSON.stringify(prAcc.json));
  if (prAcc.status !== 200) throw new Error('/api/access/project не 200');
  const acc3 = await req('/api/access', { headers: H });
  const projAcc = (acc3.json.projects || []).find(p => String(p.id) === String(pid));
  if (!projAcc || !(projAcc.users || []).some(u => String(u.id) === '7' && u.role === 'editor')) throw new Error('права на проект не сохранились');

  // 5. Сотрудник из портала
  const us = await req('/api/portal-users', { headers: H });
  console.log('\n5. Пользователи портала →', us.json.length, us.json.map(u => u.name).join(', '));
  const emp = await req('/api/employees', { method: 'POST', headers: H, body: { project_id: pid, bitrix_user_id: 7, name: 'Анна Сидорова', role: 'менеджер' } });
  console.log('   Сотрудник →', emp.status, JSON.stringify(emp.json));
  const eid = emp.json.id;

  // 6. Транзакции
  const incomeCat = cats.json.find(c => c.type === 'income').id;
  const serverCat = cats.json.find(c => c.name === 'Аренда сервера').id;
  const tx1 = await req('/api/transactions', { method: 'POST', headers: H, body: { project_id: pid, category_id: incomeCat, type: 'income', amount: 100000, date: '2026-09-01', comment: 'Аванс' } });
  const tx2 = await req('/api/transactions', { method: 'POST', headers: H, body: { project_id: pid, category_id: serverCat, type: 'expense', amount: 20000, date: '2026-09-05', employee_id: eid } });
  console.log('\n6. Транзакции →', tx1.status, tx2.status);
  if (tx1.status !== 200 || tx2.status !== 200) throw new Error('tx fail');

  // 7. Отчёт
  const rep = await req('/api/report', { method: 'GET', headers: H });
  console.log('\n7. Отчёт →', rep.status, 'доход', rep.json.income, 'расход', rep.json.expense, 'прибыль', rep.json.profit, 'маржа', rep.json.margin);
  if (rep.json.income !== 100000 || rep.json.expense !== 20000 || rep.json.profit !== 80000) throw new Error('отчёт неверен');

  // 8. Валидация: отрицательная сумма
  const bad = await req('/api/transactions', { method: 'POST', headers: H, body: { project_id: pid, category_id: incomeCat, type: 'income', amount: -5, date: '2026-09-01' } });
  console.log('8. Отрицательная сумма →', bad.status, JSON.stringify(bad.json));
  if (bad.status !== 400) throw new Error('валидация не работает');

  // 9. Список транзакций
  const list = await req('/api/transactions', { headers: H });
  console.log('9. Список →', list.status, 'total:', list.json.total, 'первая:', list.json.items[0] && list.json.items[0].project_name);

  // 10. Экспорт CSV
  const csv = await fetch(`http://localhost:${PORT}/api/export/csv`, { headers: H }).then(r => r.text());
  console.log('\n10. CSV →', csv.split('\n')[0]);

  console.log('\n✅ ИНТЕГРАЦИОННЫЕ ТЕСТЫ ПРОЙДЕНЫ');
  server.kill();
  mock.close();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ ИНТЕГРАЦИЯ НЕ ПРОЙДЕНА:', e.message);
  if (server) server.kill();
  mock.close();
  setTimeout(() => process.exit(1), 300);
});