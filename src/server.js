const path = require('path');
const express = require('express');
const config = require('./config');
const logger = require('./logger');
const { initDatabase } = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(logger.httpLogger());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    const name = path.basename(filePath);
    if (name === 'index.html' || name === 'app.js' || name === 'style.css') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.use('/', require('./routes/oauth'));
app.use('/api', require('./routes/api'));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Простой health-check
app.get('/health', (req, res) => res.json({ ok: true }));

// Обработка ошибок
app.use((err, req, res, next) => {
  logger.error(`[SERVER] ${err.message} (${req.method} ${req.originalUrl})` + (err.stack ? `\n${err.stack}` : ''));
  console.error('[SERVER]', err.message);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

process.on('unhandledRejection', (err) => {
  logger.error('[SERVER] unhandledRejection: ' + (err && err.message || err));
  console.error('[SERVER] unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  logger.error('[SERVER] uncaughtException: ' + (err && err.message || err) + (err && err.stack ? '\n' + err.stack : ''));
  console.error('[SERVER] uncaughtException:', err);
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