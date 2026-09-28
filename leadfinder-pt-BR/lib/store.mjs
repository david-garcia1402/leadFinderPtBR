import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const empty = () => ({users:[],sessions:[],subscriptions:[],checkouts:[],events:[],entitlements:[]});

export async function createStore(file) {
  await mkdir(dirname(file), {recursive:true});
  let data = empty();
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    data = {
      users: Array.isArray(raw.users) ? raw.users : [],
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
      checkouts: Array.isArray(raw.checkouts) ? raw.checkouts : [],
      events: Array.isArray(raw.events) ? raw.events : [],
      entitlements: Array.isArray(raw.entitlements) ? raw.entitlements : []
    };
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Arquivo de contas ilegível; recusando iniciar sem isolamento de clientes.');
  }
  let queue = Promise.resolve();
  const persist = async () => {
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, file);
  };
  return {
    snapshot: () => data,
    update(mutator) {
      const run = queue.then(async () => {
        const next = await mutator(data);
        if (next) data = next;
        await persist();
        return data;
      });
      queue = run.catch(() => {});
      return run;
    }
  };
}
