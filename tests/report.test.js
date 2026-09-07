const { initDatabase, db, ensureSystemCategories } = require('../src/db');
const { buildReport, listTransactions, projectsSummary, round2 } = require('../src/report');

(async () => {
  await initDatabase();
  const portal = 'testportal.ru';
  db.exec(`DELETE FROM subscriptions WHERE portal = '${portal}'`);
  db.exec(`DELETE FROM transactions WHERE portal = '${portal}'`);
  db.exec(`DELETE FROM employees WHERE portal = '${portal}'`);
  db.exec(`DELETE FROM projects WHERE portal = '${portal}'`);
  db.exec(`DELETE FROM categories WHERE portal = '${portal}'`);

  ensureSystemCategories(portal);
  const cats = db.prepare('SELECT * FROM categories WHERE portal = ?').all(portal);
  console.log('Системные статьи:', cats.map(c => c.name).join(', '));
  if (cats.length !== 6) throw new Error('Должно быть 6 системных статей');

  // Проекты
  const p1 = db.prepare('INSERT INTO projects (portal, name, color) VALUES (?,?,?)').run(portal, 'Сайт для сети салонов', '#FF6B2C').lastInsertRowid;
  const p2 = db.prepare('INSERT INTO projects (portal, name, color) VALUES (?,?,?)').run(portal, 'Мобильное приложение', '#0EA5E9').lastInsertRowid;

  // Сотрудник
  const e1 = db.prepare('INSERT INTO employees (portal, project_id, bitrix_user_id, name, role) VALUES (?,?,?,?,?)')
    .run(portal, p1, 42, 'Иван Петров', 'тимлид').lastInsertRowid;

  const byName = {};
  cats.forEach(c => { byName[c.name] = c.id; });

  // Транзакции
  const tx = (p, cat, type, amount, date, emp) =>
    db.prepare('INSERT INTO transactions (portal, project_id, category_id, type, amount, date, comment, employee_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(portal, p, cat, type, amount, date, 'test', emp).lastInsertRowid;

  // Проект 1: доход 1000+500=1500, расход 200+100+50=350 → прибыль 1150, маржа 76.7%
  tx(p1, byName['Выручка'], 'income', 1000, '2026-01-10', null);
  tx(p1, byName['Выручка'], 'income', 500, '2026-02-10', null);
  tx(p1, byName['Внешние программисты'], 'expense', 200, '2026-01-15', e1);
  tx(p1, byName['Аренда сервера'], 'expense', 100, '2026-01-20', null);
  tx(p1, byName['Расходы на ИИ'], 'expense', 50, '2026-02-05', null);

  // Проект 2: доход 300, расход 400 → убыток -100
  tx(p2, byName['Выручка'], 'income', 300, '2026-02-08', null);
  tx(p2, byName['Дивиденды'], 'expense', 400, '2026-02-09', null);

  const r1 = buildReport(portal, {});
  console.log('\n=== Общий отчёт ===');
  console.log('Доход:', r1.income, '(ожидаем 1800)');
  console.log('Расход:', r1.expense, '(ожидаем 750)');
  console.log('Прибыль:', r1.profit, '(ожидаем 1050)');
  console.log('Маржа:', r1.margin, '%(ожидаем 58.3)');
  console.log('Операций:', r1.count, '(ожидаем 7)');
  if (r1.income !== 1800) throw new Error('income != 1800');
  if (r1.expense !== 750) throw new Error('expense != 750');
  if (r1.profit !== 1050) throw new Error('profit != 1050');
  if (r1.margin !== 58.3) throw new Error('margin != 58.3, получено ' + r1.margin);
  if (r1.count !== 7) throw new Error('count != 7');

  const rJan = buildReport(portal, { dateFrom: '2026-01-01', dateTo: '2026-01-31' });
  console.log('\n=== Отчёт за январь ===');
  console.log('Доход:', rJan.income, '(ожидаем 1000), Расход:', rJan.expense, '(ожидаем 300), Прибыль:', rJan.profit, '(ожидаем 700)');
  if (rJan.income !== 1000 || rJan.expense !== 300 || rJan.profit !== 700) throw new Error('январь неверно');

  const rP1 = buildReport(portal, { projectId: p1 });
  console.log('\n=== Отчёт по проекту 1 ===');
  console.log('Доход:', rP1.income, '(1500), Расход:', rP1.expense, '(350), Прибыль:', rP1.profit, '(1150), Маржа:', rP1.margin, '(76.7)');
  if (rP1.income !== 1500 || rP1.expense !== 350 || rP1.profit !== 1150) throw new Error('проект1 неверно');
  if (rP1.margin !== 76.7) throw new Error('маржа проекта1 != 76.7');

  const rEmp = buildReport(portal, { employeeId: e1 });
  console.log('\n=== Отчёт по сотруднику ===');
  console.log('Расход:', rEmp.expense, '(ожидаем 200)');
  if (rEmp.expense !== 200) throw new Error('employee неверно');

  const rCat = buildReport(portal, { categoryId: byName['Выручка'] });
  console.log('\n=== Отчёт по статье Выручка ===');
  console.log('Доход:', rCat.income, '(ожидаем 1800)');
  if (rCat.income !== 1800) throw new Error('category неверно');

  const list = listTransactions(portal, {}, 1, 50);
  console.log('\n=== Список операций ===');
  console.log('Всего:', list.total, ', записей на странице:', list.items.length);
  console.log('Первая:', list.items[0].date, list.items[0].project_name, list.items[0].amount);
  if (list.total !== 7) throw new Error('list.total != 7');

  const sum = projectsSummary(portal, null, null);
  console.log('\n=== Сводка по проектам ===');
  sum.forEach(p => console.log(p.name, 'доход:', p.income, 'расход:', p.expense, 'прибыль:', p.profit, 'маржа:', p.margin));
  if (!sum.find(p => p.id === p1 && p.profit === 1150)) throw new Error('p1 profit wrong');
  if (!sum.find(p => p.id === p2 && p.profit === -100)) throw new Error('p2 profit wrong');

  // round2 тест
  console.log('\nround2(0.1+0.2) =', round2(0.1 + 0.2), '(ожидаем 0.3)');
  if (round2(0.1 + 0.2) !== 0.3) throw new Error('round2 fail');

  console.log('\n✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ');
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})().catch(e => { console.error('\n❌ ТЕСТ НЕ ПРОЙДЕН:', e && (e.message || e)); if (e && e.stack) console.error(e.stack); await_300_exit(); });

function await_300_exit(){ setTimeout(() => process.exit(1), 300); }