import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {createAuth,hashPassword,normalizeEmail,sessionCookie,verifyPassword} from '../lib/auth.mjs';

test('email and password rules reject invalid credentials', async () => {
  assert.equal(normalizeEmail('  User@Example.com '), 'user@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  await assert.rejects(() => hashPassword('short'));
});

test('password hash verifies only the original secret', async () => {
  const stored = await hashPassword('segredo-valido');
  assert.equal(await verifyPassword('segredo-valido', stored), true);
  assert.equal(await verifyPassword('outra-senha', stored), false);
});

test('register, login and session stay isolated per account', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lf-auth-'));
  try {
    const store = await createStore(join(dir, 'accounts.json'));
    const auth = createAuth(store);
    const created = await auth.register({email:'A@example.com', password:'senha-forte', name:'Ana'});
    assert.equal(created.email, 'a@example.com');
    await assert.rejects(() => auth.register({email:'a@example.com', password:'senha-forte'}));
    await assert.rejects(() => auth.login({email:'a@example.com', password:'errada'}));
    const session = await auth.login({email:'a@example.com', password:'senha-forte'});
    const read = auth.readSession(session.token);
    assert.equal(read.user.id, created.id);
    await auth.logout(session.token);
    assert.equal(auth.readSession(session.token), null);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('session cookie is HttpOnly and optional Secure', () => {
  assert.match(sessionCookie('abc'), /HttpOnly/);
  assert.match(sessionCookie('abc'), /SameSite=Lax/);
  assert.doesNotMatch(sessionCookie('abc', {secure:false}), /Secure/);
  assert.match(sessionCookie('abc', {secure:true}), /Secure/);
  assert.match(sessionCookie('', {clear:true}), /Max-Age=0/);
});
