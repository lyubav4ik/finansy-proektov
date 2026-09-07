/* Финансы проектов — SPA */
(function () {
  'use strict';

  var state = {
    portal: '',
    token: '',
    user: null,
    projects: [],
    categories: [],
    employees: [],
    txPage: 1,
    txTotal: 0
  };

  var $ = function (id) { return document.getElementById(id); };

  var MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  var fmt = new Intl.NumberFormat('ru-RU');

  function money(v) {
    return fmt.format(Math.round(Number(v || 0))) + ' ₽';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- API ---------- */
  /* ---------- ДЕМО-ДАННЫЕ ---------- */
  function demoSeed() {
    state.user = { id: 1, name: 'Демо-менеджер', fullName: 'Демо-менеджер', email: 'demo@demo.ru' };
    $('user-name').textContent = 'Демо-менеджер';
    state.projects = [
      { id: 1, name: 'Сайт для сети салонов', color: '#FF6B2C', budget: 500000, income: 720000, expense: 410000, profit: 310000, margin: 43.1 },
      { id: 2, name: 'Мобильное приложение', color: '#0EA5E9', budget: 300000, income: 250000, expense: 310000, profit: -60000, margin: -24 },
      { id: 3, name: 'Поддержка и доработки', color: '#10B981', budget: 100000, income: 180000, expense: 95000, profit: 85000, margin: 47.2 }
    ];
    state.categories = [
      { id: 1, name: 'Выручка', type: 'income', is_system: 1 },
      { id: 2, name: 'Внешние программисты', type: 'expense', is_system: 1 },
      { id: 3, name: 'Внутренние программисты', type: 'expense', is_system: 1 },
      { id: 4, name: 'Расходы на ИИ', type: 'expense', is_system: 1 },
      { id: 5, name: 'Аренда сервера', type: 'expense', is_system: 1 },
      { id: 6, name: 'Дивиденды', type: 'expense', is_system: 1 },
      { id: 7, name: 'Реклама', type: 'expense', is_system: 0 }
    ];
    state.employees = [
      { id: 1, project_id: 1, name: 'Иван Петров', role: 'тимлид' },
      { id: 2, project_id: 1, name: 'Анна Сидорова', role: 'менеджер' },
      { id: 3, project_id: 2, name: 'Сергей Кузнецов', role: 'разработчик' }
    ];
  }

  /* Реализация API для демо (имитация ответов сервера) */
  function demoApi(path, opts) {
    var name = (opts.method || 'GET') + ' ' + path.split('?')[0];
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (name === 'GET /api/me') return resolve(state.user);
        if (name === 'GET /api/projects') return resolve(state.projects);
        if (name === 'GET /api/categories') return resolve(state.categories);
        if (name === 'GET /api/employees') return resolve(state.employees);
        if (name === 'GET /api/report') {
          var m = Math.random();
          var byMonth = [
            { month: '2026-07', income: 210000 + (m > 0.5 ? 0 : 40000), expense: 120000, profit: 90000 },
            { month: '2026-08', income: 260000, expense: 140000, profit: 120000 },
            { month: '2026-09', income: 310000, expense: 150000, profit: 160000 }
          ];
          return resolve({
            income: 780000, expense: 410000, profit: 370000, margin: 47.4, count: 34,
            byCategory: [
              { id: 1, name: 'Выручка', type: 'income', total: 780000 },
              { id: 2, name: 'Внешние программисты', type: 'expense', total: 150000 },
              { id: 4, name: 'Расходы на ИИ', type: 'expense', total: 42000 },
              { id: 5, name: 'Аренда сервера', type: 'expense', total: 18000 },
              { id: 3, name: 'Внутренние программисты', type: 'expense', total: 200000 }
            ],
            byMonth: byMonth
          });
        }
        if (name === 'GET /api/transactions') {
          return resolve({ total: 5, page: 1, perPage: 50, items: [
            { id: 1, date: '2026-09-05', type: 'income', amount: 150000, project_name: 'Сайт для сети салонов', category_name: 'Выручка', employee_name: 'Иван Петров', comment: 'Аванс 2 этап' },
            { id: 2, date: '2026-09-04', type: 'expense', amount: 55000, project_name: 'Сайт для сети салонов', category_name: 'Внешние программисты', employee_name: '', comment: 'Фрилансер' },
            { id: 3, date: '2026-09-02', type: 'expense', amount: 12000, project_name: 'Мобильное приложение', category_name: 'Расходы на ИИ', employee_name: 'Сергей Кузнецов', comment: 'Claude подписка' },
            { id: 4, date: '2026-08-29', type: 'income', amount: 30000, project_name: 'Поддержка и доработки', category_name: 'Выручка', employee_name: 'Анна Сидорова', comment: '' },
            { id: 5, date: '2026-08-27', type: 'expense', amount: 18000, project_name: 'Поддержка и доработки', category_name: 'Реклама', employee_name: '', comment: '' }
          ] });
        }
        if (name === 'GET /api/portal-users') return resolve([{ id: 1, name: 'Иван Петров', email: '' }, { id: 2, name: 'Анна Сидорова', email: '' }]);
        if (name.startsWith('POST /api/')) return resolve({ id: 99 });
        if (name.startsWith('DELETE /api/')) return resolve(null);
        resolve(null);
      }, 120);
    });
  }

  function api(path, opts) {
    if (state.demo) return demoApi(path, opts);
    opts = opts || {};
    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: Object.assign({
        'X-Portal': state.portal,
        'X-Auth-Token': state.token,
        'Content-Type': 'application/json'
      }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.json().then(function (j) {
        if (j && j.error) throw new Error(j.error);
        return j;
      });
    });
  }

  function toast(msg, type) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'fox-toast ' + (type || 'success') + ' show';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = 'fox-toast hidden'; }, 2600);
  }

  function showError(msg) {
    var el = $('error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function hideError() { $('error').classList.add('hidden'); }

  function showLoading() { $('loading').classList.remove('hidden'); }
  function hideLoading() { $('loading').classList.add('hidden'); }

  /* ---------- АВТОРИЗАЦИЯ ---------- */
  function boot() {
    var bootEl = $('boot');

    // Демо-режим: показ интерфейса без портала (?demo в URL, вне Битрикс24)
    if (!window.BX24 && /demo/.test(window.location.search)) {
      bootEl.classList.add('hidden');
      $('app').classList.remove('hidden');
      state.portal = 'demo.ru';
      state.demo = true;
      demoSeed();
      start();
      return;
    }

    function requireSdk() {
      bootEl.innerHTML =
        '<div class="boot-card"><div class="boot-logo">🦊</div>' +
        '<h1>Финансы проектов</h1>' +
        '<p>Приложение работает внутри Битрикс24. Откройте его из меню вашего портала.</p></div>';
    }

    if (!window.BX24 || typeof BX24.init !== 'function') {
      // Попытка демо-режима из localStorage (для локального просмотра дизайна)
      var demo = JSON.parse(localStorage.getItem('finansy_demo') || 'null');
      if (demo && demo.token) {
        state.portal = demo.portal;
        state.token = demo.token;
        start();
        return;
      }
      requireSdk();
      return;
    }

    try {
      BX24.init(function () {
        BX24.getAuth(function (auth) {
          if (!auth || !auth.access_token) { requireSdk(); return; }
          state.portal = (auth.domain || '').toLowerCase();
          state.token = auth.access_token;
          bootEl.classList.add('hidden');
          $('app').classList.remove('hidden');
          start();
        });
      });
    } catch (e) {
      requireSdk();
    }
  }

  function start() {
    setupEvents();
    loadAll();
  }

  /* ---------- СБОР ДАННЫХ ---------- */
  function loadAll() {
    showLoading(); hideError();
    Promise.all([
      api('/me').then(function (u) {
        state.user = u;
        $('user-name').textContent = u.fullName || u.name || '';
      }),
      api('/projects').then(function (p) { state.projects = p; }),
      api('/categories').then(function (c) { state.categories = c; }),
      api('/employees').then(function (e) { state.employees = e; })
    ]).catch(function (err) {
      showError('Ошибка загрузки: ' + err.message);
    }).then(function () {
      fillSelects();
      renderDashboard();
      updateViews();
      hideLoading();
    });
  }

  function fillSelects() {
    var empty = '<option value="">Все проекты</option>';
    var opts = '<option value="">Выберите проект</option>';
    state.projects.forEach(function (p) {
      opts += '<option value="' + p.id + '">' + esc(p.name) + '</option>';
      empty += '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    });
    ['d-project', 't-project', 'r-project'].forEach(function (id) { $(id).innerHTML = empty; });
    ['e-project'].forEach(function (id) { $(id).innerHTML = opts; });

    var cats = '<option value="">Все статьи</option>';
    state.categories.forEach(function (c) {
      cats += '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    });
    $('r-category').innerHTML = cats;

    // Сотрудники в отчёте
    var emps = '<option value="">Все сотрудники</option>';
    var seen = {};
    state.employees.forEach(function (e) {
      if (!seen[e.id]) { seen[e.id] = 1; emps += '<option value="' + e.id + '">' + esc(e.name) + '</option>'; }
    });
    $('r-employee').innerHTML = emps;
  }

  /* ---------- ДАШБОРД ---------- */
  function renderDashboard() {
    var projectId = $('d-project').value;
    var from = monthToDate($('d-month-from').value);
    var to = monthToDate($('d-month-to').value);
    var qs = httpQuery({ project_id: projectId, date_from: from, date_to: to });

    api('/report' + qs).then(function (r) {
      $('kpi-income').textContent = money(r.income);
      $('kpi-expense').textContent = money(r.expense);
      $('kpi-profit').textContent = money(r.profit);
      $('kpi-profit').className = 'kpi-value' + (r.profit >= 0 ? ' positive' : ' negative');
      $('kpi-margin').textContent = r.margin.toLocaleString('ru-RU') + ' %';
      $('kpi-margin').className = 'kpi-value' + (r.margin >= 0 ? ' positive' : ' negative');
      $('kpi-count').textContent = 'операций: ' + r.count;
      renderChart($('d-chart'), r.byMonth);
      renderCats($('d-categories'), r.byCategory);
      loadProjectsSummary();
    }).catch(function (err) { showError('Ошибка отчёта: ' + err.message); });
  }

  function loadProjectsSummary() {
    var from = monthToDate($('d-month-from').value);
    var to = monthToDate($('d-month-to').value);
    api('/report' + httpQuery({ date_from: from, date_to: to })).then(function () {
      // суммарный отчёт уже есть; берём данные проектов из списка
      renderProjectList($('d-projects'), state.projects);
    });
  }

  function renderProjectList(el, arr) {
    if (!arr || !arr.length) { el.innerHTML = '<p style="color:var(--fox-text-secondary)">Проектов пока нет. Создайте первый.</p>'; return; }
    el.innerHTML = arr.map(function (p) {
      var cls = p.profit >= 0 ? 'positive' : 'negative';
      return '<div class="proj-row">' +
        '<span class="proj-dot" style="--pcolor:' + esc(p.color) + '"></span>' +
        '<span class="proj-name">' + esc(p.name) + '</span>' +
        '<span class="proj-val ' + cls + '">' + money(p.profit) + '</span>' +
        '<span class="proj-margin">' + Number(p.margin).toLocaleString('ru-RU') + '%</span>' +
      '</div>';
    }).join('');
  }

  function renderCats(el, arr) {
    if (!arr.length) { el.innerHTML = '<p style="color:var(--fox-text-secondary)">Нет данных за период.</p>'; return; }
    el.innerHTML = arr.map(function (c) {
      var cls = c.type === 'income' ? 'income' : 'expense';
      return '<div class="cat-stat"><div class="cs-name">' + esc(c.name) + '</div>' +
        '<div class="cs-val ' + cls + '">' + (c.type === 'expense' ? '− ' : '+ ') + money(c.total) + '</div></div>';
    }).join('');
  }

  function renderChart(el, byMonth) {
    if (!byMonth.length) {
      el.innerHTML = '<p style="color:var(--fox-text-secondary)">Нет операций за период.</p>';
      return;
    }
    var max = Math.max.apply(null, byMonth.map(function (m) { return Math.max(m.income, m.expense); })) || 1;
    el.innerHTML = byMonth.map(function (m) {
      var mName = MONTHS[parseInt(m.month.split('-')[1], 10) - 1] + ' ’' + m.month.slice(2, 4);
      var wIn = Math.max(0, Math.round(m.income / max * 100));
      var wOut = Math.max(0, Math.round(m.expense / max * 100));
      var diff = 100 - wIn - wOut;
      return '<div class="chart-row"><div class="cr-label"><span>' + mName + '</span>' +
        '<span><b class="positive">' + money(m.income) + '</b> / <b class="negative">' + money(m.expense) + '</b></span></div>' +
        '<div class="chart-bars">' +
        '<div class="b-in" style="width:' + wIn + '%"></div>' +
        '<div class="b-out" style="width:' + wOut + '%"></div>' +
        (diff > 0 ? '<div class="b-empty" style="width:' + diff + '%"></div>' : '') +
        '</div></div>';
    }).join('');
  }

  /* ---------- ОПЕРАЦИИ ---------- */
  function loadTransactions() {
    showLoading(); hideError();
    var qs = httpQuery({
      project_id: $('t-project').value,
      type: $('t-type').value,
      date_from: $('t-from').value || null,
      date_to: $('t-to').value || null,
      page: state.txPage
    });
    api('/transactions' + qs).then(function (r) {
      state.txTotal = r.total;
      $('tx-body').innerHTML = r.items.map(function (t) {
        var cls = t.type === 'income' ? 'in' : 'out';
        var sign = t.type === 'income' ? '+' : '−';
        return '<tr>' +
          '<td>' + esc(t.date) + '</td>' +
          '<td><span class="badge ' + (t.type === 'income' ? 'badge-income' : 'badge-expense') + '">' +
          (t.type === 'income' ? 'Доход' : 'Расход') + '</span></td>' +
          '<td class="txt-amount ' + cls + '">' + sign + ' ' + money(t.amount) + '</td>' +
          '<td>' + esc(t.project_name) + '</td>' +
          '<td>' + esc(t.category_name) + '</td>' +
          '<td>' + esc(t.employee_name || '—') + '</td>' +
          '<td>' + esc(t.comment || '') + '</td>' +
          '<td><button class="icon-btn del-tx" data-id="' + t.id + '" title="Удалить">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td>' +
        '</tr>';
      }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--fox-text-secondary);padding:24px">Операций нет</td></tr>';
      var pages = Math.max(1, Math.ceil(r.total / r.perPage));
      $('tx-pagination').innerHTML =
        '<span class="p-info">Стр. ' + r.page + ' из ' + pages + ' · всего ' + r.total + '</span>' +
        '<div style="display:flex;gap:8px">' +
        '<button class="fox-btn fox-btn--secondary fox-btn--sm" id="tx-prev">← Назад</button>' +
        '<button class="fox-btn fox-btn--secondary fox-btn--sm" id="tx-next">Вперёд →</button></div>';
      var next = $('tx-next');
      if (next) next.disabled = r.page >= pages;
      var prev = $('tx-prev');
      if (prev) prev.disabled = r.page <= 1;
      hideLoading();
    }).catch(function (err) { hideLoading(); showError('Ошибка: ' + err.message); });
  }

  /* ---------- ПРОЕКТЫ ---------- */
  function renderProjects() {
    var el = $('projects-grid');
    el.innerHTML = state.projects.map(function (p) {
      return '<div class="fox-card project-card" style="--pcolor:' + esc(p.color) + '">' +
        '<div class="p-name">' + esc(p.name) + '</div>' +
        '<div class="p-metrics"><span><span class="m-label">Доход:</span> +' + money(p.income) + '</span>' +
        '<span><span class="m-label">Расход:</span> −' + money(p.expense) + '</span></div>' +
        '<div class="p-metrics"><span><span class="m-label">Прибыль:</span> ' + money(p.profit) + '</span>' +
        '<span><span class="m-label">Рент.:</span> ' + Number(p.margin).toLocaleString('ru-RU') + '%</span></div>' +
        '<div class="p-actions">' +
        '<button class="fox-btn fox-btn--secondary fox-btn--sm edit-project" data-id="' + p.id + '">Изменить</button>' +
        '<button class="fox-btn fox-btn--danger fox-btn--sm del-project" data-id="' + p.id + '">Удалить</button>' +
        '</div></div>';
    }).join('') || '<div class="fox-card" style="color:var(--fox-text-secondary)">Проектов пока нет.</div>';
  }

  /* ---------- СТАТЬИ ---------- */
  function renderCategories() {
    var income = state.categories.filter(function (c) { return c.type === 'income'; });
    var expense = state.categories.filter(function (c) { return c.type === 'expense'; });
    $('cat-income').innerHTML = catList(income);
    $('cat-expense').innerHTML = catList(expense);
  }

  function catList(arr) {
    return arr.map(function (c) {
      var del = c.is_system ? '' :
        '<button class="icon-btn del-cat" data-id="' + c.id + '" title="Удалить">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
      return '<div class="cat-item"><div><div class="c-name">' + esc(c.name) + '</div>' +
        (c.is_system ? '<div class="c-tag">системная</div>' : '') + '</div>' + del + '</div>';
    }).join('');
  }

  /* ---------- СОТРУДНИКИ ---------- */
  function renderEmployees() {
    var pid = $('e-project').value;
    var arr = pid ? state.employees.filter(function (e) { return String(e.project_id) === pid; }) : state.employees;
    // группируем по проектам
    var el = $('e-list');
    if (!pid) {
      el.innerHTML = '<p style="color:var(--fox-text-secondary);padding:8px">Выберите проект, чтобы увидеть его сотрудников.</p>';
      return;
    }
    var proj = state.projects.find(function (p) { return String(p.id) === pid; });
    el.innerHTML = '<div class="cat-item" style="font-weight:600">Проект: ' + esc(proj ? proj.name : '') + '</div>' +
      arr.map(function (e) {
        return '<div class="cat-item"><div><div class="c-name">' + esc(e.name) + '</div>' +
          '<div class="c-tag">' + esc(e.role || 'Участник') + '</div></div>' +
          '<button class="icon-btn del-emp" data-id="' + e.id + '" title="Удалить">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>';
      }).join('') || '<div class="cat-item">Сотрудников в проекте нет.</div>';
  }

  /* ---------- ОТЧЁТ ---------- */
  function renderReport() {
    showLoading(); hideError();
    var qs = httpQuery({
      project_id: $('r-project').value,
      category_id: $('r-category').value,
      employee_id: $('r-employee').value,
      date_from: $('r-from').value || null,
      date_to: $('r-to').value || null
    });
    api('/report' + qs).then(function (r) {
      $('r-income').textContent = money(r.income);
      $('r-income').className = 'kpi-value positive';
      $('r-expense').textContent = money(r.expense);
      $('r-expense').className = 'kpi-value negative';
      $('r-profit').textContent = money(r.profit);
      $('r-profit').className = 'kpi-value' + (r.profit >= 0 ? ' positive' : ' negative');
      $('r-margin').textContent = r.margin.toLocaleString('ru-RU') + ' %';
      $('r-margin').className = 'kpi-value' + (r.margin >= 0 ? ' positive' : ' negative');
      renderChart($('r-chart'), r.byMonth);
      renderCats($('r-by-cat'), r.byCategory);
      hideLoading();
    }).catch(function (err) { hideLoading(); showError('Ошибка: ' + err.message); });
  }

  /* ---------- МОДАЛКИ ---------- */
  function openModal(title, bodyHtml) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    $('modal').classList.remove('hidden');
  }
  function closeModal() {
    $('modal').classList.add('hidden');
    $('modal-body').innerHTML = '';
  }

  function modalTx(id) {
    var tx = null;
    if (id) { tx = { id: id }; }
    var projOpts = state.projects.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    var catOpts = state.categories.map(function (c) {
      return '<option value="' + c.id + '" data-type="' + c.type + '">' + esc(c.name) + '</option>';
    }).join('');
    openModal(id ? 'Редактирование операции' : 'Новая операция', [
      '<div class="field"><label>Проект</label><select id="m-proj" class="fox-input">' + projOpts + '</select></div>',
      '<div class="field"><label>Статья</label><select id="m-cat" class="fox-input">' + catOpts + '</select></div>',
      '<div class="row-2">',
      '<div class="field"><label>Тип</label><select id="m-type" class="fox-input"><option value="income">Доход</option><option value="expense">Расход</option></select></div>',
      '<div class="field"><label>Сумма, ₽</label><input id="m-amount" type="number" min="0.01" step="0.01" class="fox-input" placeholder="0"></div>',
      '</div>',
      '<div class="row-2">',
      '<div class="field"><label>Дата</label><input id="m-date" type="date" class="fox-input" value="' + (new Date().toISOString().slice(0, 10)) + '"></div>',
      '<div class="field"><label>Сотрудник</label><select id="m-emp" class="fox-input"><option value="">— не указывать —</option>' +
      state.employees.map(function (e) { return '<option value="' + e.id + '">' + esc(e.name) + '</option>'; }).join('') + '</select></div>',
      '</div>',
      '<div class="field"><label>Комментарий</label><input id="m-com" class="fox-input" placeholder="Назначение платежа…"></div>',
      '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
      '<button class="fox-btn fox-btn--primary" id="m-save">Сохранить</button></div>'
    ].join(''));
    $('m-cancel').onclick = closeModal;
    $('m-save').onclick = function () {
      var catId = $('m-cat').value;
      var cat = state.categories.find(function (c) { return String(c.id) === catId; });
      var type = cat ? cat.type : $('m-type').value;
      api('/transactions' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: {
          project_id: $('m-proj').value,
          category_id: catId,
          type: type,
          amount: parseFloat($('m-amount').value),
          date: $('m-date').value,
          employee_id: $('m-emp').value || null,
          comment: $('m-com').value
        }
      }).then(function () {
        closeModal();
        toast(id ? 'Операция обновлена' : 'Операция добавлена');
        loadAll();
      }).catch(function (err) { toast(err.message, 'error'); });
    };
    // при смене статьи подставляем тип
    $('m-cat').onchange = function () {
      var c = state.categories.find(function (x) { return String(x.id) === $('m-cat').value; });
      $('m-type').value = c ? c.type : 'income';
    };
  }

  function modalProject(id) {
    var p = id ? state.projects.find(function (x) { return String(x.id) === id; }) : null;
    var colors = ['#FF6B2C', '#8B5CF6', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1'];
    var colorOpts = colors.map(function (c) {
      var checked = p ? (p.color === c) : (c === '#FF6B2C');
      return '<label style="display:inline-flex;align-items:center;margin-right:8px;cursor:pointer">' +
        '<input type="radio" name="m-color" value="' + c + '" ' + (checked ? 'checked' : '') + ' style="accent-color:' + c + '">' +
        '<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:' + c + ';margin-left:4px"></span></label>';
    }).join('');
    openModal(id ? 'Редактировать проект' : 'Новый проект', [
      '<div class="field"><label>Название</label><input id="p-name" class="fox-input" value="' + esc(p ? p.name : '') + '" placeholder="Например: Сайт для сети салонов"></div>',
      '<div class="field"><label>Бюджет, ₽ (ориентир расходов)</label><input id="p-budget" type="number" min="0" class="fox-input" value="' + (p ? p.budget : '') + '"></div>',
      '<div class="field"><label>Цвет</label><div>' + colorOpts + '</div></div>',
      '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
      '<button class="fox-btn fox-btn--primary" id="m-save">Сохранить</button></div>'
    ].join(''));
    $('m-cancel').onclick = closeModal;
    $('m-save').onclick = function () {
      var color = (document.querySelector('input[name=m-color]:checked') || {}).value || '#FF6B2C';
      api('/projects' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: { name: $('p-name').value, budget: parseFloat($('p-budget').value) || 0, color: color }
      }).then(function () {
        closeModal();
        toast(id ? 'Проект обновлён' : 'Проект создан');
        loadAll();
      }).catch(function (err) { toast(err.message, 'error'); });
    };
  }

  function modalCategory(type) {
    openModal(type === 'expense' ? 'Новая статья расходов' : 'Новая статья дохода', [
      '<div class="field"><label>Название статьи</label><input id="c-name" class="fox-input" placeholder="Например: Реклама, Маркетинг, Поддержка…"></div>',
      '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
      '<button class="fox-btn fox-btn--primary" id="m-save">Добавить</button></div>'
    ].join(''));
    $('m-cancel').onclick = closeModal;
    $('m-save').onclick = function () {
      api('/categories', { method: 'POST', body: { name: $('c-name').value, type: type } })
        .then(function () {
          closeModal();
          toast('Статья добавлена');
          loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
    };
  }

  function modalEmployee(pid) {
    pid = pid || $('e-project').value;
    if (!pid) { toast('Сначала выберите проект', 'error'); return; }
    var proj = state.projects.find(function (p) { return String(p.id) === pid; });
    // пользователи портала
    api('/portal-users').then(function (users) {
      var opts = '<option value="">Ввести вручную</option>' +
        users.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + '</option>'; }).join('');
      openModal('Добавить сотрудника в «' + esc(proj ? proj.name : '') + '»', [
        '<div class="field"><label>Сотрудник Битрикс24 (или вручную)</label><select id="e-name-select" class="fox-input">' + opts + '</select></div>',
        '<div class="field"><label>Имя (если вручную)</label><input id="e-name" class="fox-input" placeholder="ФИО"></div>',
        '<div class="field"><label>Роль</label><input id="e-role" class="fox-input" placeholder="Например: тимлид, менеджер"></div>',
        '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
        '<button class="fox-btn fox-btn--primary" id="m-save">Добавить</button></div>'
      ].join(''));
      $('m-cancel').onclick = closeModal;
      $('e-name-select').onchange = function () {
        $('e-name').value = $('e-name-select').selectedOptions[0] && $('e-name-select').selectedOptions[0].text;
      };
      $('m-save').onclick = function () {
        api('/employees', {
          method: 'POST',
          body: {
            project_id: pid,
            bitrix_user_id: $('e-name-select').value || null,
            name: $('e-name').value.trim(),
            role: $('e-role').value.trim()
          }
        }).then(function () {
          closeModal();
          toast('Сотрудник добавлен');
          loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      };
    }).catch(function (err) { toast('Не удалось получить пользователей: ' + err.message, 'error'); });
  }

  /* ---------- СОБЫТИЯ ---------- */
  function setupEvents() {
    // табы
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.onclick = function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
        tab.classList.add('active');
        $('view-' + tab.dataset.tab).classList.remove('hidden');
        updateViews();
      };
    });

    // закрытие модалки
    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.onclick = closeModal;
    });

    // дашборд фильтры
    ['d-project', 'd-month-from', 'd-month-to'].forEach(function (id) {
      $(id).onchange = renderDashboard;
    });

    // транзакции
    $('btn-new-tx').onclick = function () { modalTx(); };
    $('btn-tx-filter').onclick = function () { state.txPage = 1; loadTransactions(); };
    $('t-project').onchange = function () { state.txPage = 1; loadTransactions(); };
    $('t-type').onchange = function () { state.txPage = 1; loadTransactions(); };

    $('tx-body').onclick = function (e) {
      var del = e.target.closest('.del-tx');
      if (!del) return;
      if (!confirm('Удалить операцию?')) return;
      api('/transactions/' + del.dataset.id, { method: 'DELETE' }).then(function () {
        toast('Операция удалена');
        loadTransactions();
        loadAll();
      }).catch(function (err) { toast(err.message, 'error'); });
    };

    // проекты
    $('btn-new-project').onclick = function () { modalProject(); };
    $('projects-grid').onclick = function (e) {
      var edit = e.target.closest('.edit-project');
      var del = e.target.closest('.del-project');
      if (edit) { modalProject(edit.dataset.id); return; }
      if (del) {
        if (!confirm('Удалить проект и все его операции?')) return;
        api('/projects/' + del.dataset.id, { method: 'DELETE' }).then(function () {
          toast('Проект удалён');
          loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    };

    // статьи
    $('btn-new-cat-expense').onclick = function () { modalCategory('expense'); };
    $('btn-new-cat-income').onclick = function () { modalCategory('income'); };
    $('cat-income').onclick = catDeleteClick;
    $('cat-expense').onclick = catDeleteClick;

    // сотрудники
    $('btn-new-employee').onclick = function () { modalEmployee(); };
    $('e-project').onchange = renderEmployees;
    $('e-list').onclick = function (e) {
      var del = e.target.closest('.del-emp');
      if (!del) return;
      if (!confirm('Удалить сотрудника из проекта?')) return;
      api('/employees/' + del.dataset.id, { method: 'DELETE' }).then(function () {
        toast('Сотрудник удалён');
        loadAll();
      }).catch(function (err) { toast(err.message, 'error'); });
    };

    // отчёт
    $('btn-report').onclick = renderReport;

    // экспорт
    $('btn-export').onclick = function () {
      var q = httpQuery({ project_id: $('t-project').value, type: $('t-type').value });
      fetch('/api/export/csv' + q, {
        headers: { 'X-Portal': state.portal, 'X-Auth-Token': state.token }
      }).then(function (r) {
        if (!r.ok) throw new Error('Ошибка экспорта');
        return r.blob();
      }).then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'finansy-proektov.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Экспорт готов');
      }).catch(function (err) { toast(err.message, 'error'); });
    };
  }

  function catDeleteClick(e) {
    var del = e.target.closest('.del-cat');
    if (!del) return;
    if (!confirm('Удалить статью? Операции по ней останутся в базе.')) return;
    api('/categories/' + del.dataset.id, { method: 'DELETE' }).then(function () {
      toast('Статья удалена');
      loadAll();
    }).catch(function (err) { toast(err.message, 'error'); });
  }

  function updateViews() {
    var tab = document.querySelector('.tab.active');
    if (!tab) return;
    switch (tab.dataset.tab) {
      case 'dashboard': renderDashboard(); break;
      case 'transactions': loadTransactions(); break;
      case 'projects': renderProjects(); break;
      case 'categories': renderCategories(); break;
      case 'employees': renderEmployees(); break;
      case 'report': renderReport(); break;
    }
  }

  /* ---------- УТИЛИТЫ ---------- */
  function httpQuery(obj) {
    var s = Object.keys(obj).filter(function (k) { return obj[k] !== '' && obj[k] !== null && obj[k] !== undefined; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]); }).join('&');
    return s ? '?' + s : '';
  }

  function monthToDate(v) {
    return v ? v + '-01' : '';
  }

  boot();
})();