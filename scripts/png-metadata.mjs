import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const metadata = new Set(['tEXt','zTXt','iTXt','eXIf']);
// Blender's generated textures carry only these two 72/1 DPI rationals.
const textureResolution = Buffer.from('4d4d002a00000018000000480000000100000048000000010002011a00050000000100000008011b0005000000010000001000000000','hex');
export function stripPngMetadata(buffer) {
  inspectPng(buffer);
  const chunks = [buffer.subarray(0,8)];
  for(let p=8;p<buffer.length;) {
    const length=buffer.readUInt32BE(p), type=buffer.toString('ascii',p+4,p+8);
    if(!metadata.has(type)) chunks.push(buffer.subarray(p,p+length+12));
    p+=length+12;
  }
  return Buffer.concat(chunks);
}
export function inspectPng(buffer, { allowTextureResolution = false } = {}) {
  if (!buffer.subarray(0,8).equals(signature)) throw new Error('Invalid PNG signature');
  const issues = [];
  let end = false;
  for (let p=8;p<buffer.length;) {
    if (p+12>buffer.length) throw new Error('Truncated PNG');
    const length=buffer.readUInt32BE(p), type=buffer.toString('ascii',p+4,p+8);
    if (p+12+length>buffer.length) throw new Error('Invalid PNG chunk length');
    const data=buffer.subarray(p+8,p+8+length);
    if (['eXIf','iTXt','zTXt'].includes(type) && !(type==='eXIf' && allowTextureResolution && data.equals(textureResolution))) issues.push('Unreviewed PNG metadata: '+type);
    if (type==='tEXt') {
      const zero=data.indexOf(0), key=data.subarray(0,zero).toString('utf8'), value=data.subarray(zero+1).toString('utf8');
      const metric=/^cycles\.ViewLayer\.(samples|total_time|render_time|synchronization_time)$/.test(key);
      if (zero<0 || !metric || !/^[\d.: ]+$/.test(value)) issues.push('Unreviewed PNG text metadata');
    }
    p+=length+12;
    if(type==='IEND') { if(p!==buffer.length)issues.push('Trailing PNG data');end=true;break; }
  }
  if(!end)throw new Error('Missing PNG end');
  return issues;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href && process.argv[2]==='--clean') {
  for(const file of process.argv.slice(3)) {
    const clean=stripPngMetadata(readFileSync(file));
    if(inspectPng(clean).length)throw new Error('PNG metadata cleanup failed');
    writeFileSync(file,clean);
  }
}
