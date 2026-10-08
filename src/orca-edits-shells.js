'use strict';
// Orca kapanırken açık terminal kabuklarını (ve içindeki süreçleri) kapatır; sahipsiz pwsh/claude birikmesini önler.
const { DEFS } = require('./orca-snippets/quit-kill');

const DEF_ANCHOR = 'function eXr(){I.ipcMain.removeHandler(`pty:management:listSessions`),';
const TEARDOWN = '{name:`daemon`,promise:Kua()?GQt():WQt()}';
const MAIN = /^out\/main\/.*\.js$/;
const patches = [
  { group: 'shells', glob: MAIN, from: DEF_ANCHOR, to: DEFS + DEF_ANCHOR },
  { group: 'shells', glob: MAIN, from: TEARDOWN, to: '{name:`daemon`,promise:__syzerQuitDaemon(Kua()?GQt:WQt)}' },
];
module.exports = { patches };
