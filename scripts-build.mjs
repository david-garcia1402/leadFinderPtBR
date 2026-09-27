import {mkdir,cp,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
for(const p of ['public','lib','src','server.mjs','package.json','wrangler.jsonc','.env.example'])await cp(p,'dist/'+p,{recursive:true});
console.log('Portable Node distribution created in dist/. Start with node --env-file-if-exists=.env server.mjs');
