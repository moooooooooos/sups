// Настройки домена пишет deploy.sh в data/.deploy.json (файл не хранится в git)
let deploy = {};
try {
  deploy = require('./data/.deploy.json');
} catch (e) {
  deploy = {};
}

module.exports = {
  apps: [
    {
      name: 'sups-store',
      script: './server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Адрес сайта для ссылок в sitemap, canonical и письмах (https://домен)
        SITE_URL: deploy.siteUrl || ''
      }
    }
  ]
};
