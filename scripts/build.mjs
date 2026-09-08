import { build } from 'esbuild';
await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', outfile: 'public/app.bundle.js', minify: true, legalComments: 'eof', target: 'es2022' });
console.log('Public demo built. No camera server is included in the browser bundle.');
