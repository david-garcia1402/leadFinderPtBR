import {createApp} from '../lib/app.mjs';
import {createMemoryStore} from '../lib/store.mjs';

let ready;

function appFor(env) {
  if (!ready) {
    ready = createApp({
      env,
      store: createMemoryStore(),
      getIp: request => request.headers.get('cf-connecting-ip') || '',
      loadAsset: async assetPath => {
        const response = await env.ASSETS.fetch(new Request(new URL(assetPath, 'https://assets.local')));
        if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      }
    });
  }
  return ready;
}

export default {
  async fetch(request, env) {
    const app = await appFor(env);
    return app.handle(request);
  }
};
