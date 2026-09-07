const path = require('path');
const express = require('express');
const config = require('./config');
const { initDatabase } = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/oauth'));
app.use('/api', require('./routes/api'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Простой health-check
app.get('/health', (req, res) => res.json({ ok: true }));

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('[SERVER]', err.message);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

initDatabase()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`[SERVER] Финансы проектов слушает порт ${config.port}`);
    });
  })
  .catch((e) => {
    console.error('[SERVER] Не удалось инициализировать БД:', e);
    process.exit(1);
  });