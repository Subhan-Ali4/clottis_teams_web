import crypto from 'node:crypto';

// ---- Password hashing (scrypt, per-user random salt) -----------------------
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(plain, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(plain, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used when the email does not exist, so response time does not reveal it.
const DUMMY_HASH = hashPassword('dummy-password-for-timing');
export function burnPasswordCheck(plain) {
  verifyPassword(plain, DUMMY_HASH);
}

// ---- System-generated initial passwords -----------------------------------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
export function generatePassword(length = 16) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

// ---- Session tokens --------------------------------------------------------
export const newSessionToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ---- Validation ------------------------------------------------------------
export const ROLES = ['owner', 'admin', 'member'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();
export const isValidEmail = (e) => e.length <= 254 && EMAIL_RE.test(e);
export const isValidName = (n) => typeof n === 'string' && n.trim().length >= 2 && n.trim().length <= 100;
export const isValidPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128;
