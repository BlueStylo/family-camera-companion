import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoPTZ } from '../src/ptz-state.js';

test('mock PTZ responds and stops at a finite deadline', () => {
  const p = new DemoPTZ(); p.move('right', 0); p.tick(100, 100);
  assert.ok(Math.abs(p.pan-3.5)<1e-8); p.tick(100, 1500);
  assert.ok(Math.abs(p.pan-3.5)<1e-8); assert.equal(p.state.moving, false);
  p.move('up', 1600); p.stop(); p.tick(100, 1700); assert.equal(p.tilt, -18);
});
test('mock PTZ clamps pan, tilt and zoom and resets all motion', () => {
  const p = new DemoPTZ();
  for (let i=0;i<1000;i++) { p.move('left', i); p.tick(100,i); }
  assert.equal(p.pan,-150);
  for (let i=0;i<1000;i++) { p.move('down', i); p.tick(100,i); }
  assert.equal(p.tilt,-75); p.zoom(-1000); assert.equal(p.fov,25);
  p.zoom(1000); assert.equal(p.fov,90);
  assert.throws(()=>p.move('invalid')); assert.throws(()=>p.zoom(NaN));
  p.reset(); assert.deepEqual(p.state,{pan:0,tilt:-18,fov:70,moving:false});
});
