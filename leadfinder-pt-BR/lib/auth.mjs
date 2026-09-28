import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return null;
  return email;
}

export function validatePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) throw new Error('A senha deve ter entre 8 e 128 caracteres.');
  return password;
}

export function validateName(value) {
  const name = String(value || '').trim();
  if (!name) return '';
  if (name.length > 80) throw new Error('Informe um nome com até 80 caracteres.');
  return name;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(validatePassword(password), salt, 32);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(hash).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (!salt.length || expected.length !== 32) return false;
  const actual = Buffer.from(await scryptAsync(String(password || ''), salt, 32));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newId(prefix = '') {
  return prefix + randomBytes(16).toString('hex');
}

export function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(token, {secure = false, maxAge = SESSION_MS / 1000, clear = false} = {}) {
  const parts = [
    `lf_session=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : Math.floor(maxAge)}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function publicUser(user, subscription) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    createdAt: user.createdAt,
    subscription
  };
}

export function createAuth(store) {
  const prune = (data, now = Date.now()) => {
    data.sessions = data.sessions.filter(session => session.expiresAt > now);
  };

  return {
    async register({email, password, name}) {
      const normalized = normalizeEmail(email);
      if (!normalized) throw new Error('Informe um e-mail válido.');
      const displayName = validateName(name);
      const passwordHash = await hashPassword(password);
      const user = {
        id: newId('usr_'),
        email: normalized,
        name: displayName,
        passwordHash,
        createdAt: new Date().toISOString()
      };
      await store.update(data => {
        if (data.users.some(item => item.email === normalized)) throw new Error('Já existe uma conta com este e-mail.');
        data.users.push(user);
      });
      return {id: user.id, email: user.email, name: user.name, createdAt: user.createdAt};
    },

    async login({email, password}) {
      const normalized = normalizeEmail(email);
      const users = store.snapshot().users;
      const user = normalized && users.find(item => item.email === normalized);
      const ok = user && await verifyPassword(password, user.passwordHash);
      if (!ok) throw new Error('E-mail ou senha inválidos.');
      const token = newId();
      const session = {
        id: newId('ses_'),
        userId: user.id,
        tokenHash: tokenHash(token),
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + SESSION_MS
      };
      await store.update(data => {
        prune(data);
        data.sessions.push(session);
      });
      return {token, user: {id: user.id, email: user.email, name: user.name, createdAt: user.createdAt}};
    },

    async logout(token) {
      if (!token) return;
      const hash = tokenHash(token);
      await store.update(data => {
        data.sessions = data.sessions.filter(session => session.tokenHash !== hash);
      });
    },

    readSession(token) {
      if (!token) return null;
      const hash = tokenHash(token);
      const now = Date.now();
      const session = store.snapshot().sessions.find(item => item.tokenHash === hash && item.expiresAt > now);
      if (!session) return null;
      const user = store.snapshot().users.find(item => item.id === session.userId);
      return user ? {session, user} : null;
    }
  };
}
