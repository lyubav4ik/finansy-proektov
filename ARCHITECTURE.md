# Архитектура «Финансы проектов»

## Тип
Galaxy App (Node.js + Express 4 + better-sqlite3) для Маркетплейса Битрикс24.

## Данные (SQLite, /data)
- **projects** — id, name, budget, color, created_at
- **categories** — id, name, type (`income`/`expense`), is_system, portal
- **employees** — id, project_id, name, bitrix_user_id, role
- **transactions** — id, project_id, category_id, type, amount, date, comment, employee_id
- **subscriptions** — portal, access_token, refresh_token, client_endpoint (OAuth)

Системные статьи расходов (создаются при установке):
внешние программисты, внутренние программисты, расходы на ИИ, аренда сервера, дивиденды.
Системная статья дохода: выручка.

## Авторизация
- OAuth-поток Битрикс24: установка → `/oauth` → save tokens → redirect
- Запросы от фронтенда авторизуются проверкой access_token пользователя портала
- Мультидоступ: все сотрудники портала работают с данными портала
- Идентификация пользователя: user.current → id → это сотрудник

## Битрикс24 REST
- `bitrixApi(portal, method, params)` — POST https://{client_endpoint}{method}
- Обновление токенов автоматически (refresh_token)
- Сотрудники проекта — выбор из `user.get` портала

## Расчёты
- Доход = сумма income по проекту/периоду
- Расход = сумма expense
- Прибыль = доход − расход
- Рентабельность = прибыль / доход × 100% (если доход = 0 → 0)

## API маршруты
- `/oauth` — OAuth-поток
- `/api/subscription` — статус установки
- `/api/me` — текущий пользователь
- `/api/projects` CRUD
- `/api/categories` CRUD (+ системные)
- `/api/employees` CRUD
- `/api/transactions` CRUD (+ фильтры)
- `/api/report` — сводка: доход, расход, прибыль, рентабельность, фильтры
- `/api/export/csv` — выгрузка

## Фронтенд
- Один SPA: index.html + app.js + style.css (FoxStyle)
- Вкладки: Дашборд, Проекты, Статьи, Сотрудники, Транзакции, Отчёт
- Glassmorphism, mobile first

## Деплой
- Galaxy-сервер, accessPolicy PUBLIC, автосон 15 мин
- Использовать составленную tar.gz из src/

## Безопасность
- Ключи только в env
- .env в .gitignore
- Валидация входных данных в API
- Один портал — своя изоляция данных по subscriptions