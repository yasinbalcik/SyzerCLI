'use strict';

// Sürüm paketini (syzercli-<ver>.tar.gz) ve launcher bundle'ını üretir → dist/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

const tarName = `syzercli-${pkg.version}.tar.gz`;
const r = spawnSync('tar', ['-czf', `dist/${tarName}`, 'bin', 'src', 'package.json', 'README.md'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(1);

// launcher: updater.js'i tek dosyaya göm (SEA yalnızca tek betik alır)
const upd = fs.readFileSync(path.join(root, 'src', 'updater.js'), 'utf8');
const launcher = fs.readFileSync(path.join(root, 'launcher', 'launcher.js'), 'utf8')
  .replace(/^const U = require\('\.\.\/src\/updater'\); \/\/@UPDATER$/m,
    `const U = (() => { const module = { exports: {} }; (function (module, exports) {\n${upd}\n})(module, module.exports); return module.exports; })();`);
fs.writeFileSync(path.join(dist, 'launcher.bundle.js'), launcher);
console.log(`dist/${tarName}, dist/launcher.bundle.js`);
