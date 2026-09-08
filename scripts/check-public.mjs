import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectPng } from './png-metadata.mjs';

const skip = new Set(['.git','node_modules','output','.playwright-cli','__pycache__']);
const allowedBinary = new Set(['assets/models/villa.blend','public/assets/villa.glb','public/assets/overview.png','public/assets/top-view.png']);
const errors = [];
const approved = new Set(JSON.parse(await readFile('scripts/public-files.json','utf8')));
const tracked = execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for (const file of tracked) if (!approved.has(file)) errors.push(file+': tracked file is not on the reviewed publication list');
const rules = [
  ['local user path', /\/(?:Users|home)\/[a-zA-Z][^\s"']*\//],
  ['private network address', /\b(?:192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/],
  ['credential-bearing URL', /(?:rtsp|https?):\/\/[^\s/@]+:[^\s/@]+@/i],
  ['private key or access token', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['source photo filename', /IMG_\d{4}\.(?:jpg|jpeg)|codex-clipboard-[a-f0-9-]+/i]
];
async function walk(dir='') {
  for (const entry of await readdir(dir||'.',{withFileTypes:true})) {
    if (skip.has(entry.name)) continue;
    const file = path.posix.join(dir,entry.name);
    if (entry.isSymbolicLink()) { errors.push(file+': symlink not allowed');continue; }
    if (entry.isDirectory()) { await walk(file);continue; }
    if (!approved.has(file) && file !== 'public/app.bundle.js') errors.push(file+': file is not on the reviewed publication list');
    if (/(?:\.local\.json|\.sqlite.*|\.db|\.log|\.blend[12])$/.test(file)||/^\.env(?:\.|$)/.test(file)) errors.push(file+': private artifact');
    const data = await readFile(file);
    if (allowedBinary.has(file)) continue;
    if (!/\.(?:md|json|js|mjs|html|css|py|yml|yaml)$/.test(file) && !['LICENSE','.gitignore'].includes(file)) errors.push(file+': unreviewed file type');
    const text=data.toString('utf8');
    for (const [name,pattern] of rules) if (pattern.test(text)) errors.push(file+': '+name);
    // Test fixtures use only the explicitly synthetic 010-0000-xxxx range.
    for (const match of text.matchAll(/\b010-?\d{4}-?\d{4}\b/g)) if (!/^010-?0000-?\d{4}$/.test(match[0])) errors.push(file+': phone-like value');
  }
}
await walk();
const audit=JSON.parse(await readFile('assets/models/public-audit.json','utf8'));
for (const [file,expected] of Object.entries(audit.sha256)) {
  const actual=createHash('sha256').update(await readFile(file)).digest('hex');
  if (actual!==expected) errors.push(file+': asset changed since Blender/privacy review');
}
for (const file of allowedBinary) if (!audit.sha256[file]) errors.push(file+': missing audit hash');
for (const file of ['public/assets/overview.png','public/assets/top-view.png']) {
  for(const issue of inspectPng(await readFile(file))) errors.push(file+': '+issue);
}
const blend=await readFile('assets/models/villa.blend');
if(blend.toString('ascii',0,7)!=='BLENDER') errors.push('Blender source must be uncompressed for full-file path scanning');
else for(const [name,pattern] of rules) if(pattern.test(blend.toString('utf8'))) errors.push('Blender: '+name);
const data=await readFile('public/assets/villa.glb');
const gltf=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
if (gltf.images?.length!==2 || gltf.images.some(i=>i.uri||i.bufferView===undefined) || gltf.buffers.some(b=>b.uri)) errors.push('GLB must embed only the two reviewed texture images');
const metadata=JSON.stringify(gltf);
for(const [name,pattern] of rules) if(pattern.test(metadata)) errors.push('GLB: '+name);
const spec=JSON.parse(await readFile('public/assets/site.json','utf8'));
if(spec.cameras.length||spec.photos.length||spec.roadReference||spec.objects.some(o=>o.photos)) errors.push('Private source data in public site spec');
if(errors.length) { console.error(errors.join('\n'));process.exitCode=1; }
else console.log('Public file and model audit passed. Human visual review remains required; this does not guarantee anonymity.');
