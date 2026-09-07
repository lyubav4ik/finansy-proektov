require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  serverUrl: process.env.SERVER_URL || '',
  clientId: process.env.OAUTH_CLIENT_ID || '',
  clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
  dbPath: process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'finansy.db'),
  b24Protocol: process.env.B24_PROTOCOL || 'https'
};