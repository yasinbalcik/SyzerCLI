'use strict';
// Orca kapanırken açık terminal kabuklarını (ve içindeki süreçleri) kapatır; sahipsiz pwsh/claude birikmesini önler.
const { DEFS } = require('./orca-snippets/quit-kill');

const ANCHOR = 'function eXr(){I.ipcMain.removeHandler(`pty:management:listSessions`),';
const patches = [
  { group: 'shells', glob: /^out\/main\/.*\.js$/, from: ANCHOR, to: `${DEFS}function eXr(){__syzerInstallQuitKill(),I.ipcMain.removeHandler(\`pty:management:listSessions\`),` },
];
module.exports = { patches };
