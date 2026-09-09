const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const OLD_FILE = path.join(LOG_DIR, 'app.old.log');
const MAX_BYTES = 1024 * 1024; // 1 МБ

function ensureDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_BYTES) {
      if (fs.existsSync(OLD_FILE)) fs.unlinkSync(OLD_FILE);
      fs.renameSync(LOG_FILE, OLD_FILE);
    }
  } catch (e) { /* файла ещё нет — ок */ }
}

function line(msg) {
  ensureDir();
  rotateIfNeeded();
  fs.appendFileSync(LOG_FILE, msg + '\n', 'utf8');
}

/** Лог HTTP-запроса: ИП, метод, URL, статус, длительность, портал */
function httpLogger() {
  return (req, res, next) => {
    const t0 = Date.now();
    res.on('finish', () => {
      const portal = req.headers['x-portal'] || req.query.DOMAIN || req.body?.DOMAIN || '-';
      const msg = [
        iso(),
        `[req]`,
        `ip=${req.ip}`,
        `portal=${portal}`,
        `${req.method} ${req.originalUrl}`,
        `→ ${res.statusCode} ${Date.now() - t0}ms`,
        `ua=${String(req.headers['user-agent'] || '-').slice(0, 80)}`
      ].join(' ');
      line(msg);
      console.log(msg); // дублируем в stdout (видно через Galaxy API)
    });
    next();
  };
}

function info(msg) { line(`${iso()} [info] ${msg}`); console.log(`[info] ${msg}`); }
function warn(msg) { line(`${iso()} [warn] ${msg}`); console.log(`[warn] ${msg}`); }
function error(msg) { line(`${iso()} [error] ${msg}`); console.error(`[error] ${msg}`); }
function iso() { return new Date().toISOString(); }

module.exports = { httpLogger, info, warn, error };