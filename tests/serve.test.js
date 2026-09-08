import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDemoServer } from '../scripts/serve.mjs';

test('demo serves only public assets and exposes no camera or auth API', async () => {
  const server = createDemoServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base = 'http://127.0.0.1:'+server.address().port;
  try {
    const page=await fetch(base);assert.match(await page.text(),/모의 영상/);
    assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
    for (const url of ['/api/cameras','/api/auth/request','/server/server.js','/assets/models/villa.blend']) {
      assert.equal((await fetch(base+url)).status,404);
    }
    const traversal=await new Promise(resolve=>http.get(base+'/%2e%2e%2fserver/server.js',r=>{r.resume();resolve(r.statusCode);}));
    assert.equal(traversal,403);
    assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
    const json=await (await fetch(base+'/assets/site.json')).json();
    assert.deepEqual(json.cameras,[]);assert.deepEqual(json.photos,[]);
  } finally { server.closeAllConnections();await new Promise(r=>server.close(r)); }
});
