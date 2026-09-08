const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { externalPath, loadCameras } = require('./config');

test('live camera server fails closed without explicit external configuration', () => {
  assert.throws(()=>loadCameras({}),/CAMERAS_FILE/);
  assert.throws(()=>externalPath('PRIVATE_DIR',{PRIVATE_DIR:'relative'}),/absolute/);
  assert.throws(()=>externalPath('PRIVATE_DIR',{PRIVATE_DIR:__dirname}),/outside/);
});
test('external camera schema removes extra fields and rejects invalid destinations and duplicates', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'companion-config-'));
  const file=path.join(dir,'cameras.json'), env={CAMERAS_FILE:file};
  const c={id:'camera-1',name:'Example',ip:'192.0.2.10'};
  const write=data=>fs.writeFileSync(file,JSON.stringify(data));
  try {
    write([{...c,serial:'unused'}]);assert.deepEqual(loadCameras(env),[c]);
    write([c,c]);assert.throws(()=>loadCameras(env),/Duplicate/);
    for (const extra of [{ip:'example.com/path'}, {id:'"><script>'},{name:''}]) {
      write([{...c,...extra}]);assert.throws(()=>loadCameras(env),/Invalid/);
    }
    const link=path.join(dir,'repo');fs.symlinkSync(path.resolve(__dirname,'..'),link);
    assert.throws(()=>externalPath('PRIVATE_DIR',{PRIVATE_DIR:path.join(link,'new-data')}),/outside/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
