import {createApp} from '../lib/app.mjs';
import {createD1Store} from '../lib/d1-store.mjs';

let appPromise;
let store;

function jsonError(error) {
  return new Response(JSON.stringify({error: error.message || 'Falha ao acessar o banco.'}), {
    status: 500,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}
  });
}

export default {
  async fetch(request, env) {
    try {
      if (!env.DB) return jsonError(new Error('Banco D1 não vinculado neste Worker.'));
      if (!store) {
        store = createD1Store(env.DB);
        appPromise = createApp({
          env,
          store,
          getIp: current => current.headers.get('cf-connecting-ip') || '',
          loadAsset: async assetPath => {
            const response = await env.ASSETS.fetch(new Request(new URL(assetPath, 'https://assets.local')));
            if (!response.ok) return null;
            return new Uint8Array(await response.arrayBuffer());
          }
        });
      }
      await store.refresh();
      const app = await appPromise;
      return app.handle(request);
    } catch (error) {
      return jsonError(error);
    }
  }
};
