/**
 * Создать администратора или сменить ему пароль.
 *   node scripts/set-admin-password.js                — спросит логин и пароль
 *   ADMIN_USER=admin ADMIN_PASSWORD=... node scripts/set-admin-password.js
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../src/db');

function ask(question, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      rl._writeToOutput = text => {
        if (text.includes(question)) rl.output.write(text);
      };
    }
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

(async () => {
  const username = process.env.ADMIN_USER || (process.env.ADMIN_PASSWORD ? 'admin' : (await ask('Логин администратора [admin]: '))) || 'admin';
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await ask('Новый пароль (не короче 10 символов): ', true);
    const again = await ask('Повторите пароль: ', true);
    if (password !== again) {
      console.error('❌ Пароли не совпадают');
      process.exit(1);
    }
  }
  if (password.length < 10 || ['admin123', 'password12', '1234567890'].includes(password)) {
    console.error('❌ Пароль слишком простой: нужно не меньше 10 символов');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 10);
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
  if (existing) {
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.log(`✅ Пароль администратора «${username}» обновлён`);
  } else {
    db.prepare("INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
    console.log(`✅ Администратор «${username}» создан`);
  }
})();
