const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const REPO = fs.realpathSync(path.resolve(__dirname, '..'));

function externalPath(key, env = process.env) {
  const value = env[key];
  if (!value || !path.isAbsolute(value)) throw new Error(key + ' must be an absolute path outside the repository');
  const resolved = path.resolve(value);
  let existing = resolved;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const actual = path.resolve(fs.realpathSync(existing), path.relative(existing, resolved));
  const relative = path.relative(REPO, actual);
  if (!relative || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
    throw new Error(key + ' must be outside the repository');
  }
  return actual;
}

function loadCameras(env = process.env) {
  const file = externalPath('CAMERAS_FILE', env);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data) || data.length < 1 || data.length > 16) throw new Error('Expected 1-16 configured cameras');
  const cameras = data.map(c => {
    if (!c || !/^[a-z][a-z0-9-]{0,39}$/.test(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 80 || net.isIP(c.ip) !== 4) {
      throw new Error('Invalid camera configuration');
    }
    return { id: c.id, name: c.name, ip: c.ip };
  });
  if (new Set(cameras.map(c => c.id)).size !== cameras.length) throw new Error('Duplicate camera id');
  return cameras;
}

module.exports = { externalPath, loadCameras };
