import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPng, stripPngMetadata } from '../scripts/png-metadata.mjs';
import { readFileSync } from 'node:fs';

test('rendered public PNGs contain only reviewed numeric render metadata', () => {
  for(const file of ['overview.png','top-view.png'])assert.deepEqual(inspectPng(readFileSync(new URL('../public/assets/'+file,import.meta.url))),[]);
});
test('PNG metadata inspector rejects file paths, compressed text and EXIF', () => {
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  const chunk=(type,text='')=>{const data=Buffer.from(text),size=Buffer.alloc(4);size.writeUInt32BE(data.length);return Buffer.concat([size,Buffer.from(type),data,Buffer.alloc(4)]);};
  for (const [type,text] of [['tEXt','File\0private-project.blend'],['zTXt','compressed'],['iTXt','international'],['eXIf','metadata']]) {
    const pixelChunk=chunk('IDAT','unchanged compressed pixel bytes');
    const image=Buffer.concat([signature,chunk(type,text),pixelChunk,chunk('IEND')]);
    assert.equal(inspectPng(image).length,1);
    assert.equal(inspectPng(image,{allowTextureResolution:true}).length,1);
    const clean=stripPngMetadata(image);
    assert.deepEqual(inspectPng(clean),[]);
    assert.ok(clean.includes(pixelChunk));
  }
  assert.throws(()=>inspectPng(Buffer.from('not an image')),/signature/);
});
