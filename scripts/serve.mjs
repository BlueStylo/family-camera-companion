import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.svg':'image/svg+xml' };
export function createDemoServer() {
  return http.createServer(async (req,res) => {
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405);res.end();return; }
    try {
      const pathname = decodeURIComponent(req.url.split('?')[0]);
      const file = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      const base = await realpath(root);
      if (!file.startsWith(base+path.sep)) { res.writeHead(403);res.end();return; }
      const actual = await realpath(file);
      if (!actual.startsWith(base+path.sep)) { res.writeHead(403);res.end();return; }
      if (!(await stat(actual)).isFile()) { res.writeHead(404);res.end();return; }
      const body = await readFile(actual);
      res.writeHead(200,{
        'Content-Type':types[path.extname(actual)]||'application/octet-stream',
        'Content-Length':body.length,
        'Cache-Control':'no-cache',
        'X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      });
      res.end(req.method==='HEAD'?undefined:body);
    } catch (error) { res.writeHead(error instanceof URIError?400:404);res.end(); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDemoServer();
  server.listen(Number(process.env.PORT||4180),'127.0.0.1',()=>console.log('Public demo: http://localhost:'+server.address().port));
}
