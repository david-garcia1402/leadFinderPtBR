import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createD1Store} from '../lib/d1-store.mjs';
import {createAuth} from '../lib/auth.mjs';
import {createBilling} from '../lib/billing.mjs';

function asD1(sqlite) {
  return {
    prepare(sql) {
      const statement = params => ({sql, params});
      const bound = statement([]);
      bound.bind = (...params) => statement(params);
      return bound;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) {
          const prepared = sqlite.prepare(statement.sql);
          const params = statement.params || [];
          if (/^\s*select/i.test(statement.sql)) results.push({results: prepared.all(...params)});
          else {
            prepared.run(...params);
            results.push({results: []});
          }
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

test('register and session survive a new D1 store on the same database', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = asD1(sqlite);
  const first = createD1Store(db);
  const auth = createAuth(first);
  const created = await auth.register({email:'Ana@example.com', password:'senha-forte', name:'Ana'});
  const session = await auth.login({email:created.email, password:'senha-forte'});

  const second = createD1Store(db);
  await second.refresh();
  const again = createAuth(second);
  const read = again.readSession(session.token);
  assert.equal(read.user.email, 'ana@example.com');
  assert.equal(read.user.name, 'Ana');
  await assert.rejects(() => again.register({email:'ana@example.com', password:'senha-forte'}));
  await again.logout(session.token);

  const third = createD1Store(db);
  await third.refresh();
  assert.equal(createAuth(third).readSession(session.token), null);
  assert.equal(third.snapshot().users.length, 1);
});

test('subscription survives reload in D1', async () => {
  const db = asD1(new DatabaseSync(':memory:'));
  const store = createD1Store(db);
  const auth = createAuth(store);
  const user = await auth.register({email:'plano@example.com', password:'senha-forte'});
  const billing = createBilling(store, {});
  const active = await billing.activateForTests(user.id, 'essencial');
  assert.equal(active.status, 'authorized');

  const reloaded = createD1Store(db);
  await reloaded.refresh();
  const status = createBilling(reloaded, {}).statusFor(user.id);
  assert.equal(status.planId, 'essencial');
  assert.equal(status.status, 'authorized');
});
