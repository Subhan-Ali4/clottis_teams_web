// Creates the first Owner. Password is read from the environment and never printed.
//   OWNER_NAME="Your Name" OWNER_EMAIL=you@example.com OWNER_PASSWORD='long-password' npm run seed:owner
import { openDb } from '../src/db.js';
import { hashPassword, normalizeEmail, isValidEmail, isValidName, isValidPassword } from '../src/security.js';

const name = process.env.OWNER_NAME;
const email = normalizeEmail(process.env.OWNER_EMAIL);
const password = process.env.OWNER_PASSWORD;

if (!isValidName(name) || !isValidEmail(email) || !isValidPassword(password)) {
  console.error('Set OWNER_NAME, OWNER_EMAIL (valid) and OWNER_PASSWORD (8+ chars) first.');
  process.exit(1);
}

const db = openDb();
if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
  console.error('A user with that email already exists.');
  process.exit(1);
}
db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
  .run(name.trim(), email, hashPassword(password), 'owner');
console.log(`Owner created: ${email}`);
