const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS app_records (
    collection TEXT NOT NULL,
    record_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection, record_id)
  )`
];

const empty = () => ({users:[], sessions:[], subscriptions:[], checkouts:[], events:[], entitlements:[]});

function userFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    passwordHash: row.password_hash,
    createdAt: row.created_at
  };
}

function sessionFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: Number(row.expires_at)
  };
}

export function createD1Store(db) {
  if (!db) throw new Error('Banco D1 não vinculado. Confira d1_databases no wrangler.jsonc.');
  let data = empty();
  let queue = Promise.resolve();
  let schemaReady = false;

  const enqueue = task => {
    const run = queue.then(task);
    queue = run.then(() => {}, () => {});
    return run;
  };

  async function ensureSchema() {
    if (schemaReady) return;
    await db.batch(SCHEMA.map(sql => db.prepare(sql)));
    schemaReady = true;
  }

  async function load() {
    await ensureSchema();
    const [users, sessions, records] = await db.batch([
      db.prepare('SELECT id, email, name, password_hash, created_at FROM users'),
      db.prepare('SELECT id, user_id, token_hash, created_at, expires_at FROM sessions'),
      db.prepare('SELECT collection, data FROM app_records ORDER BY collection, record_id')
    ]);
    const next = empty();
    next.users = users.results.map(userFromRow);
    next.sessions = sessions.results.map(sessionFromRow);
    for (const row of records.results) {
      if (!Object.hasOwn(next, row.collection)) continue;
      next[row.collection].push(JSON.parse(row.data));
    }
    data = next;
  }

  function changed(before, after, idOf) {
    const previous = new Map(before.map(item => [idOf(item), item]));
    const current = new Map(after.map(item => [idOf(item), item]));
    const removed = [];
    const upserts = [];
    for (const [id, row] of previous) {
      if (!current.has(id)) removed.push(id);
    }
    for (const [id, row] of current) {
      const prior = previous.get(id);
      if (!prior || JSON.stringify(prior) !== JSON.stringify(row)) upserts.push(row);
    }
    return {removed, upserts};
  }

  async function save(before) {
    const users = changed(before.users, data.users, item => item.id);
    const sessions = changed(before.sessions, data.sessions, item => item.id);
    const recordId = {
      subscriptions: item => item.userId,
      checkouts: item => item.id,
      events: item => item.id,
      entitlements: item => `${item.email}|${item.orderId || ''}|${item.action || ''}|${item.createdAt || ''}`
    };
    const statements = [
      ...sessions.removed.map(id => db.prepare('DELETE FROM sessions WHERE id = ?').bind(id)),
      ...users.removed.map(id => db.prepare('DELETE FROM users WHERE id = ?').bind(id)),
      ...users.upserts.map(user => db.prepare(
        'INSERT OR REPLACE INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(user.id, user.email, user.name || '', user.passwordHash, user.createdAt)),
      ...sessions.upserts.map(session => db.prepare(
        'INSERT OR REPLACE INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt))
    ];
    for (const collection of Object.keys(recordId)) {
      const diff = changed(before[collection], data[collection], recordId[collection]);
      statements.push(...diff.removed.map(id => db.prepare(
        'DELETE FROM app_records WHERE collection = ? AND record_id = ?'
      ).bind(collection, id)));
      statements.push(...diff.upserts.map(item => db.prepare(
        'INSERT OR REPLACE INTO app_records (collection, record_id, data) VALUES (?, ?, ?)'
      ).bind(collection, recordId[collection](item), JSON.stringify(item))));
    }
    if (!statements.length) return;
    try {
      await db.batch(statements);
    } catch (error) {
      if (/unique/i.test(String(error.message)) && /email/i.test(String(error.message))) {
        throw new Error('Já existe uma conta com este e-mail.');
      }
      throw error;
    }
  }

  return {
    snapshot: () => data,
    refresh: () => enqueue(load),
    update(mutator) {
      return enqueue(async () => {
        await load();
        const before = structuredClone(data);
        const next = await mutator(data);
        if (next) data = next;
        await save(before);
        return data;
      });
    }
  };
}
