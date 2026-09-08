import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = ['assets/models/villa.blend','assets/models/verification.json','public/assets/villa.glb','public/assets/site.json','public/assets/overview.png','public/assets/top-view.png'];
const verification = JSON.parse(await readFile(files[1],'utf8'));
if (!verification.blendOpened || verification.packedImages !== 2) throw new Error('Run the Blender public-model verifier first');
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile('assets/models/public-audit.json',JSON.stringify({schema:1,review:'Procedural textures only; no source photographs or actual camera poses. Model geometry intentionally public.',sha256:hashes},null,2)+'\n');
