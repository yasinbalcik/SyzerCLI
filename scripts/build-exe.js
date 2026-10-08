'use strict';

// Node SEA ile dist/syzer.exe üretir (node.exe + launcher). Gerekli: Node >= 20, npx postject (otomatik iner).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const run = (cmd, args, opt = {}) => { const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' && cmd === 'npx', ...opt }); if (r.status !== 0) { console.error(`failed: ${cmd} ${args.join(' ')}`); process.exit(1); } };

require('./pack.js');
fs.writeFileSync(path.join(dist, 'sea-config.json'), JSON.stringify({ main: 'launcher.bundle.js', output: 'sea.blob', disableExperimentalSEAWarning: true }));
run(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { cwd: dist });
const exe = path.join(dist, process.platform === 'win32' ? 'syzer.exe' : 'syzer');
fs.copyFileSync(process.execPath, exe);
run('npx', ['--yes', 'postject', exe, 'NODE_SEA_BLOB', path.join(dist, 'sea.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);
console.log(`built ${exe}`);
