/* Финансы проектов — SPA */
(function () {
  'use strict';

  var state = {
    portal: '',
    token: '',
    user: null,
    projects: [],
    categories: [],
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
  function api(path, opts) {
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

    // Запасной путь: если SDK не отвечает — спрашиваем сервер, какой портал установлен,
    // и входим сохранённым при установке токеном.
    function enterByServerPortal() {
      fetch('/api/portal').then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.portal) {
          state.portal = String(d.portal).toLowerCase();
          state.token = '';
          bootEl.classList.add('hidden');
          $('app').classList.remove('hidden');
          start();
          toast('Вход через установку портала');
          return;
        }
        failBoot('Приложение не установлено на портал или установок несколько. Откройте его из меню Битрикс24.');
      }).catch(function () {
        failBoot('Не удалось подключиться к серверу приложения.');
      });
    }

    if (!window.BX24 || typeof BX24.init !== 'function') {
      enterByServerPortal();
      return;
    }

    var done = false;
    var failTimer = setTimeout(function () {
      if (!done) enterByServerPortal();
    }, 4000);

    function finish(auth) {
      if (done) return;
      if (auth && auth.access_token && auth.domain) {
        done = true;
        clearTimeout(failTimer);
        state.portal = String(auth.domain).toLowerCase();
        state.token = auth.access_token;
        bootEl.classList.add('hidden');
        $('app').classList.remove('hidden');
        start();
        return;
      }
      // токена нет — пробуем домен, иначе серверный портал
      try {
        BX24.getDomain(function (domain) {
          if (done) return;
          if (domain) {
            done = true;
            clearTimeout(failTimer);
            state.portal = String(domain).toLowerCase();
            state.token = '';
            bootEl.classList.add('hidden');
            $('app').classList.remove('hidden');
            start();
            return;
          }
          if (!done) enterByServerPortal();
        });
      } catch (e) {
        if (!done) enterByServerPortal();
      }
    }

    try {
      BX24.init(function () {
        try {
          BX24.getAuth(finish);
        } catch (e) {
          finish(null);
        }
      });
    } catch (e) {
      clearTimeout(failTimer);
      enterByServerPortal();
    }
  }

  function failBoot(msg) {
    var boot = $('boot');
    boot.querySelector('p').textContent = '';
    var card = boot.querySelector('.boot-card');
    var p = document.createElement('p');
    p.style.color = '#C2410C';
    p.textContent = msg;
    var btn = document.createElement('button');
    btn.className = 'fox-btn fox-btn--primary';
    btn.style.marginTop = '18px';
    btn.textContent = 'Обновить';
    btn.onclick = function () { window.location.reload(); };
    boot.querySelector('.fox-spinner').style.display = 'none';
    card.appendChild(p);
    card.appendChild(btn);
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
        if (u.admin) { $('tab-access').classList.remove('hidden'); }
      }),
      api('/projects').then(function (p) { state.projects = p; }),
      api('/categories').then(function (c) { state.categories = c; })
    ]).catch(function (err) {
      showError('Ошибка загрузки: ' + err.message);
    }).then(function () {
      fillSelects();
      applyPermButtons();
      renderDashboard();
      updateViews();
      hideLoading();
    });
  }

  /* Прячем кнопки создания/удаления, если нет прав */
  function applyPermButtons() {
    var shown = function (id, ok) { if ($(id)) $(id).classList.toggle('hidden', !ok); };
    shown('btn-new-project', canGlobal('createProject'));
    shown('btn-new-tx', canGlobal('createTx') || state.projects.some(function (p) { return canOnProject(p.id, 2); }));
    shown('btn-new-cat-expense', canGlobal('manageCategory'));
    shown('btn-new-cat-income', canGlobal('manageCategory'));
  }

  /* Эффективная роль для проекта: project_access → глобальная */
  function projectRole(pid) {
    if (state.user && state.user.projectRoles && state.user.projectRoles[pid] != null) return state.user.projectRoles[pid];
    return state.user ? state.user.role : 'none';
  }
  function canOnProject(pid, need) {
    var lvl = { none: 0, viewer: 1, editor: 2, full: 3, admin: 4 };
    var r = projectRole(pid);
    return (lvl[r] || 0) >= need;
  }
  function canGlobal(permName) {
    return !!(state.user && state.user.perm && state.user.perm[permName]);
  }

  function fillSelects() {
    var empty = '<option value="">Все проекты</option>';
    var opts = '<option value="">Выберите проект</option>';
    state.projects.forEach(function (p) {
      opts += '<option value="' + p.id + '">' + esc(p.name) + '</option>';
      empty += '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    });
    ['d-project', 't-project'].forEach(function (id) { $(id).innerHTML = empty; });

    var cats = '<option value="">Все статьи</option>';
    state.categories.forEach(function (c) {
      cats += '<option value="' + c.id + '">' + esc(c.name) + '</option>';
    });
    $('d-category').innerHTML = cats;
  }

  /* ---------- АНАЛИТИКА ---------- */
  function renderDashboard() {
    var projectId = $('d-project').value;
    var categoryId = $('d-category').value;
    var from = $('d-from').value || null;
    var to = $('d-to').value || null;
    var qs = httpQuery({ project_id: projectId, category_id: categoryId, date_from: from, date_to: to });

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
      renderProjectList($('d-projects'), state.projects);
    }).catch(function (err) { showError('Ошибка отчёта: ' + err.message); });
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
        var canDel = canOnProject(t.project_id, 3);
        return '<tr>' +
          '<td>' + esc(t.date) + '</td>' +
          '<td><span class="badge ' + (t.type === 'income' ? 'badge-income' : 'badge-expense') + '">' +
          (t.type === 'income' ? 'Доход' : 'Расход') + '</span></td>' +
          '<td class="txt-amount ' + cls + '">' + sign + ' ' + money(t.amount) + '</td>' +
          '<td>' + esc(t.project_name) + '</td>' +
          '<td>' + esc(t.category_name) + '</td>' +
          '<td>' + esc(t.author_name || '—') + '</td>' +
          '<td>' + esc(t.comment || '') + '</td>' +
          '<td>' + (canDel
            ? '<button class="icon-btn del-tx" data-id="' + t.id + '" title="Удалить">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
            : '') + '</td>' +
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
    if (!state.projects.length) {
      var canCreate = canGlobal('createProject');
      el.innerHTML =
        '<div class="fox-card empty-projects">' +
        '<div class="empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--fox-orange)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>' +
        '<h3 class="empty-title">Проектов пока нет</h3>' +
        '<p class="empty-sub">Создайте первый проект, чтобы учитывать его доходы и расходы и видеть рентабельность.</p>' +
        (canCreate
          ? '<button class="fox-btn fox-btn--primary fox-btn--lg" id="btn-empty-project">+ Создать первый проект</button>'
          : '<p class="muted" style="margin:8px 0 0">Создавать проекты может администратор или редактор.</p>') +
        '</div>';
      var b = $('btn-empty-project');
      if (b) b.onclick = function () { modalProject(); };
      return;
    }
    el.innerHTML = state.projects.map(function (p) {
      var canEdit = canOnProject(p.id, 2);
      var canDelete = canOnProject(p.id, 3);
      var isAdmin = state.user && state.user.admin;
      var actions = '';
      if (canEdit) actions += '<button class="fox-btn fox-btn--secondary fox-btn--sm edit-project" data-id="' + p.id + '">Изменить</button>';
      if (canDelete) actions += '<button class="fox-btn fox-btn--danger fox-btn--sm del-project" data-id="' + p.id + '">Удалить</button>';
      if (isAdmin) actions += '<button class="fox-btn fox-btn--secondary fox-btn--sm pr-access" data-id="' + p.id + '">Доступ</button>';
      return '<div class="fox-card project-card" style="--pcolor:' + esc(p.color) + '">' +
        '<div class="p-name">' + esc(p.name) + '</div>' +
        '<div class="p-metrics"><span><span class="m-label">Доход:</span> +' + money(p.income) + '</span>' +
        '<span><span class="m-label">Расход:</span> −' + money(p.expense) + '</span></div>' +
        '<div class="p-metrics"><span><span class="m-label">Прибыль:</span> ' + money(p.profit) + '</span>' +
        '<span><span class="m-label">Рент.:</span> ' + Number(p.margin).toLocaleString('ru-RU') + '%</span></div>' +
        '<div class="p-actions">' + actions + '</div></div>';
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
      var del = (c.is_system || !canGlobal('deleteCategory')) ? '' :
        '<button class="icon-btn del-cat" data-id="' + c.id + '" title="Удалить">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
      return '<div class="cat-item"><div><div class="c-name">' + esc(c.name) + '</div>' +
        (c.is_system ? '<div class="c-tag">системная</div>' : '') + '</div>' + del + '</div>';
    }).join('');
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
    var projOpts = state.projects.filter(function (p) { return canOnProject(p.id, 2); }).map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    if (!projOpts) { toast('Нет проектов с правом на изменение', 'error'); return; }
    var catOpts = state.categories.map(function (c) {
      return '<option value="' + c.id + '" data-type="' + c.type + '">' + esc(c.name) + '</option>';
    }).join('');
    openModal(id ? 'Редактирование операции' : 'Новая операция', [
      '<div class="field"><label>Проект</label><select id="m-proj" class="fox-input">' + projOpts + '</select></div>',
      '<div class="field"><label>Статья</label><select id="m-cat" class="fox-input">' + catOpts + '</select></div>',
      '<div class="row-2">',
      '<div class="field"><label>Сумма, ₽</label><input id="m-amount" type="number" min="0.01" step="0.01" class="fox-input" placeholder="0"></div>',
      '<div class="field"><label>Дата</label><input id="m-date" type="date" class="fox-input" value="' + (new Date().toISOString().slice(0, 10)) + '"></div>',
      '</div>',
      '<div class="field"><label>Комментарий</label><input id="m-com" class="fox-input" placeholder="Назначение платежа…"></div>',
      '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
      '<button class="fox-btn fox-btn--primary" id="m-save">Сохранить</button></div>'
    ].join(''));
    $('m-cancel').onclick = closeModal;
    $('m-save').onclick = function () {
      var catId = $('m-cat').value;
      if (!catId) { toast('Выберите статью', 'error'); return; }
      var cat = state.categories.find(function (c) { return String(c.id) === catId; });
      var type = cat ? cat.type : 'expense';
      api('/transactions' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: {
          project_id: $('m-proj').value,
          category_id: catId,
          type: type,
          amount: parseFloat($('m-amount').value),
          date: $('m-date').value,
          comment: $('m-com').value
        }
      }).then(function () {
        closeModal();
        toast(id ? 'Операция обновлена' : 'Операция добавлена');
        loadAll();
      }).catch(function (err) { toast(err.message, 'error'); });
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
    var isAdmin = state.user && state.user.admin;
    // секция прав на проект (только админ) — подгружается асинхронно
    var accessSection = isAdmin
      ? '<div class="field"><label>Права на этот проект</label><div id="proj-access"><span class="muted">Загрузка прав…</span></div></div>'
      : '';
    openModal(id ? 'Редактировать проект' : 'Новый проект', [
      '<div class="field"><label>Название</label><input id="p-name" class="fox-input" value="' + esc(p ? p.name : '') + '" placeholder="Например: Сайт для сети салонов"></div>',
      '<div class="field"><label>Бюджет, ₽ (ориентир расходов)</label><input id="p-budget" type="number" min="0" class="fox-input" value="' + (p ? p.budget : '') + '"></div>',
      '<div class="field"><label>Цвет</label><div>' + colorOpts + '</div></div>',
      accessSection,
      '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
      '<button class="fox-btn fox-btn--primary" id="m-save">Сохранить</button></div>'
    ].join(''));
    if (isAdmin) loadProjectAccessBlock($('proj-access'), id);
    $('m-cancel').onclick = closeModal;
    $('m-save').onclick = function () {
      var color = (document.querySelector('input[name=m-color]:checked') || {}).value || '#FF6B2C';
      api('/projects' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: { name: $('p-name').value, budget: parseFloat($('p-budget').value) || 0, color: color }
      }).then(function (saved) {
        var pid = saved ? saved.id : parseInt(id, 10);
        return saveProjectAccess(pid).then(function () { return saved; });
      }).then(function () {
        closeModal();
        toast(id ? 'Проект обновлён' : 'Проект создан');
        loadAll();
      }).catch(function (err) { toast(err.message, 'error'); });
    };
  }

  /* Права на конкретный проект: группы ролей с чипами (как в общих доступах) */
  function projectRoleGroupsHtml(users, departments) {
    return ACCESS_ROLES.map(function (g) {
      var userChips = (users || []).filter(function (u) { return u.role === g.role; }).map(function (u) {
        return chipHtml('user', u.id, u.name);
      }).join('');
      var deptChips = (departments || []).filter(function (d) { return d.role === g.role; }).map(function (d) {
        return chipHtml('dept', d.id, d.name);
      }).join('');
      return '<div class="ac-group ac-group--' + g.role + '" data-role="' + g.role + '">' +
        '<div class="ac-group-head"><b>' + g.label + '</b><span>' + g.desc + '</span></div>' +
        '<div class="ac-chips">' + userChips + deptChips + '</div>' +
        '<button type="button" class="fox-btn fox-btn--secondary fox-btn--sm ac-add">+ Добавить</button>' +
        '</div>';
    }).join('');
  }

  /* Загрузить текущие права на проект в контейнер прав */
  function loadProjectAccessBlock(container, pid) {
    function renderEmpty() { container.innerHTML = projectRoleGroupsHtml([], []) || ''; bindAccessEvents(); }
    if (!pid) { renderEmpty(); return; }
    api('/access').then(function (d) {
      var proj = (d.projects || []).find(function (p) { return String(p.id) === String(pid); });
      container.innerHTML = projectRoleGroupsHtml(proj ? proj.users : [], proj ? proj.departments : []) || '';
      bindAccessEvents();
    }).catch(function (err) { container.innerHTML = '<span class="muted">Не удалось загрузить права: ' + esc(err.message) + '</span>'; });
  }

  /* Сохранить права на проект (все grants разом) */
  function saveProjectAccess(pid) {
    var cont = $('proj-access');
    if (!cont) return Promise.resolve();
    var retry = 0;
    function wait() {
      return new Promise(function (resolve, reject) {
        var t = setInterval(function () {
          if (cont.querySelectorAll('.ac-group').length) {
            clearInterval(t);
            resolve();
          } else if (++retry > 40) {
            clearInterval(t);
            resolve(); // всё равно сохраним то, что есть
          }
        }, 100);
      });
    }
    return wait().then(function () {
      var grants = collectGrants('proj-access');
      return api('/access/project', { method: 'POST', body: { project_id: parseInt(pid, 10), grants: grants } })
        .then(function () { return grants; });
    });
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

  /* Права на конкретный проект (админ, из карточки проекта) */
  function modalProjectAccess(pid) {
    var proj = state.projects.find(function (p) { return String(p.id) === String(pid); });
    api('/access').then(function (d) {
      var pacc = (d.projects || []).find(function (p) { return String(p.id) === String(pid); }) || { users: [], departments: [] };
      openModal('Доступ к проекту «' + esc(proj ? proj.name : '') + '»', [
        '<div id="proj-access" style="margin-bottom:14px">' + projectRoleGroupsHtml(pacc.users, pacc.departments) + '</div>',
        '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
        '<button class="fox-btn fox-btn--primary" id="m-save-pac">Сохранить</button></div>'
      ].join(''));
      bindAccessEvents();
      $('m-cancel').onclick = closeModal;
      $('m-save-pac').onclick = function () {
        saveProjectAccess(pid).then(function () {
          closeModal();
          toast('Права на проект сохранены');
          loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      };
    }).catch(function (err) { toast('Ошибка: ' + err.message, 'error'); });
  }

  /* ---------- СОБЫТИЯ ---------- */
  function setupEvents() {
    // табы
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.onclick = function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
        tab.classList.remove('hidden');
        tab.classList.add('active');
        $('view-' + tab.dataset.tab).classList.remove('hidden');
        updateViews();
      };
    });

    // доступы
    $('btn-access-save').onclick = saveAccess;

    // закрытие модалки
    document.querySelectorAll('[data-close]').forEach(function (el) {
      el.onclick = closeModal;
    });

    // аналитика фильтры
    ['d-project', 'd-category'].forEach(function (id) {
      $(id).onchange = renderDashboard;
    });
    $('btn-d-report').onclick = renderDashboard;

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
      var acc = e.target.closest('.pr-access');
      if (acc) { modalProjectAccess(acc.dataset.id); return; }
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
      case 'access': renderAccess(); break;
    }
  }

  /* ---------- ДОСТУПЫ ---------- */
  var accessData = { users: [], departments: [], projects: [], firstTime: false };
  var ACCESS_ROLES = [
    { role: 'admin', label: 'Админ', desc: 'полный доступ и управление правами' },
    { role: 'full', label: 'Вносит и удаляет', desc: 'создаёт, редактирует и удаляет всё' },
    { role: 'editor', label: 'Вносит изменения', desc: 'создаёт и редактирует, не удаляет' },
    { role: 'viewer', label: 'Только чтение', desc: 'видит данные, ничего не меняет' }
  ];

  function renderAccess() {
    return api('/access').then(function (d) {
      accessData = { users: d.users || [], departments: d.departments || [], projects: d.projects || [], firstTime: !!d.firstTime };
      renderAccessGroups();
    }).catch(function (err) { showError('Ошибка доступов: ' + err.message); });
  }

  /* Чип выбранного сотрудника / отдела */
  function chipHtml(kind, id, name) {
    var icon = kind === 'dept'
      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
    return '<span class="ac-chip ' + (kind === 'dept' ? 'ac-chip--dept' : '') + '" data-kind="' + kind + '" data-id="' + id + '" data-name="' + esc(name) + '">' +
      icon + '<span>' + esc(name) + '</span>' +
      '<button type="button" class="chip-x" title="Убрать">' +
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button></span>';
  }

  /* Открыть штатный выбор Битрикс24 (или fallback-список) и добавить чипы в группу */
  function openUserPicker(role, container) {
    var dash = container.querySelector('.ac-chips');

    function addPicked(result) {
      (result || []).forEach(function (it) {
        var kind;
        var id;
        var idMatch = /^(DR?)(\d+)$/.exec(it.id || '');
        var uMatch = /^U(\d+)$/.exec(it.id || '');
        if (uMatch) { kind = 'user'; id = uMatch[1]; }
        else if (idMatch) { kind = 'dept'; id = idMatch[2]; }
        else if (it.provider === 'user') { kind = 'user'; id = /^U(\d+)$/.exec(it.id); id = id && id[1]; }
        else return; // группы (SG/…) и AU/G2/CR в права проекта не добавляем
        if (!id) return;
        var name = it.name || (kind === 'dept' ? 'Отдел ' + id : 'ID ' + id);
        // убираем дубль из других ролей
        container.querySelectorAll('.ac-chips .ac-chip[data-kind="' + kind + '"][data-id="' + id + '"]').forEach(function (c) { c.remove(); });
        dash.insertAdjacentHTML('beforeend', chipHtml(kind, id, name));
      });
    }

    if (window.BX24 && typeof BX24.selectAccess === 'function') {
      BX24.selectAccess(addPicked);
      return;
    }
    // fallback вне Битрикс24: простой выбор из списков
    Promise.all([api('/portal-users'), api('/departments')]).then(function (rs) {
      var users = rs[0] || [], depts = rs[1] || [];
      var rows = users.map(function (u) {
        var hit = dash.querySelector('.ac-chip[data-kind="user"][data-id="' + u.id + '"]');
        return '<label class="ac-member" style="display:block"><input type="checkbox" class="fb-pick" data-kind="user" data-id="' + u.id + '" data-name="' + esc(u.name) + '"' +
          (hit ? ' checked' : '') + '><span class="ac-name">' + esc(u.name) + '</span></label>';
      }).join('');
      rows += depts.map(function (d) {
        var hit = dash.querySelector('.ac-chip[data-kind="dept"][data-id="' + d.id + '"]');
        return '<label class="ac-member" style="display:block"><input type="checkbox" class="fb-pick" data-kind="dept" data-id="' + d.id + '" data-name="' + esc(d.name || ('Отдел ' + d.id)) + '"' +
          (hit ? ' checked' : '') + '><span class="ac-name">' + esc(d.name || ('Отдел ' + d.id)) + '</span></label>';
      }).join('');
      openModal('Выбрать сотрудников и отделы', [
        '<div style="max-height:300px;overflow:auto;margin-bottom:12px">' + rows + '</div>',
        '<div class="modal-actions"><button class="fox-btn fox-btn--secondary" id="m-cancel">Отмена</button>' +
        '<button class="fox-btn fox-btn--primary" id="m-pick-ok">Добавить</button></div>'
      ].join(''));
      $('m-cancel').onclick = closeModal;
      $('m-pick-ok').onclick = function () {
        var picked = [];
        document.querySelectorAll('.fb-pick:checked').forEach(function (c) {
          picked.push({ id: (c.dataset.kind === 'dept' ? 'D' : 'U') + c.dataset.id, name: c.dataset.name });
        });
        closeModal();
        addPicked(picked);
      };
    }).catch(function (err) { toast('Не удалось загрузить списки: ' + err.message, 'error'); });
  }

  /* Общие доступы: 4 роли, под каждой — кнопка «+ Добавить» и чипы */
  function renderAccessGroups() {
    var el = $('access-groups');
    var selfId = state.user ? String(state.user.id) : '';
    el.innerHTML = ACCESS_ROLES.map(function (g) {
      var userChips = accessData.users.filter(function (u) { return u.globalRole === g.role; }).map(function (u) {
        return chipHtml('user', u.id, u.name);
      }).join('');
      var deptChips = accessData.departments.filter(function (d) { return d.globalRole === g.role; }).map(function (d) {
        return chipHtml('dept', d.id, d.name);
      }).join('');
      return '<div class="ac-group ac-group--' + g.role + '" data-role="' + g.role + '">' +
        '<div class="ac-group-head"><b>' + g.label + '</b><span>' + g.desc + '</span></div>' +
        '<div class="ac-chips">' + userChips + deptChips + '</div>' +
        '<button type="button" class="fox-btn fox-btn--secondary fox-btn--sm ac-add">+ Добавить</button>' +
        '</div>';
    }).join('');
    bindAccessEvents();
  }

  function bindAccessEvents() {
    document.querySelectorAll('.ac-group').forEach(function (group) {
      group.querySelector('.ac-add').onclick = function () { openUserPicker(group.dataset.role, group); };
      group.querySelector('.ac-chips').onclick = function (e) {
        var x = e.target.closest('.chip-x');
        if (x) x.closest('.ac-chip').remove();
      };
    });
  }

  function collectGrants(scopeTab) {
    var grants = [];
    document.querySelectorAll((scopeTab ? '#' + scopeTab : '#access-groups') + ' .ac-group').forEach(function (g) {
      var role = g.dataset.role;
      g.querySelectorAll('.ac-chip').forEach(function (c) {
        if (c.dataset.kind === 'dept') {
          grants.push({ dept_id: parseInt(c.dataset.id, 10), dept_name: c.dataset.name, role: role });
        } else {
          grants.push({ user_id: parseInt(c.dataset.id, 10), name: c.dataset.name, role: role });
        }
      });
    });
    return grants;
  }

  function saveAccess() {
    var grants = collectGrants();
    api('/access/batch', { method: 'POST', body: { grants: grants } }).then(function () {
      toast('Права сохранены');
      renderAccess();
    }).catch(function (err) { toast(err.message, 'error'); });
  }

  /* ---------- УТИЛИТЫ ---------- */
  function httpQuery(obj) {
    var s = Object.keys(obj).filter(function (k) { return obj[k] !== '' && obj[k] !== null && obj[k] !== undefined; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]); }).join('&');
    return s ? '?' + s : '';
  }

  boot();
})();