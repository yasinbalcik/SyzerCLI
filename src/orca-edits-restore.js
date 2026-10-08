'use strict';
// Proposed restore patches (exact from/to) + uniqueness check against the extracted Orca bundle (read-only).

const RESUME_SZ = 'case`syzer`:return t.key===`session_id`?[`syzer`,`--resume`,r]:null;';
const patches = [
  // --- renderer: resume argv + resumable set (store chunk)
  { name: 'R1 renderer argv', glob: /^renderer\/assets\/store-.*\.js$/,
    from: 'case`jcode`:return t.key===`session_id`?[`jcode`,`--resume`,r]:null}}var WF=new Set([',
    to: 'case`jcode`:return t.key===`session_id`?[`jcode`,`--resume`,r]:null;' + RESUME_SZ.replace(/;$/, '') + '}}var WF=new Set([' },
  { name: 'R2 renderer set', glob: /^renderer\/assets\/store-.*\.js$/,
    from: '`zcode`,`dsh`,`jcode`]),GF=512',
    to: '`zcode`,`dsh`,`jcode`,`syzer`]),GF=512' },
  // --- main: shared module chunk (argv, RESUMABLE list/set, provider-session extractor)
  { name: 'M1 main argv', glob: /^main\/chunks\/daemon-cgroup-scope-.*\.js$/,
    from: 'case`jcode`:return t.key===`session_id`?[`jcode`,`--resume`,r]:null}}const le=[',
    to: 'case`jcode`:return t.key===`session_id`?[`jcode`,`--resume`,r]:null;' + RESUME_SZ.replace(/;$/, '') + '}}const le=[' },
  { name: 'M2 main list', glob: /^main\/chunks\/daemon-cgroup-scope-.*\.js$/,
    from: '`zcode`,`dsh`,`jcode`];var ue=new Set(le)',
    to: '`zcode`,`dsh`,`jcode`,`syzer`];var ue=new Set(le)' },
  { name: 'M3 main extractor', glob: /^main\/chunks\/daemon-cgroup-scope-.*\.js$/,
    from: 'case`jcode`:{let e=T(t,[`session_id`,`sessionId`]);return e?{key:`session_id`,id:e}:null}case`omp`:',
    to: 'case`syzer`:{let e=T(t,[`session_id`]);return e?{key:`session_id`,id:e}:null}case`jcode`:{let e=T(t,[`session_id`,`sessionId`]);return e?{key:`session_id`,id:e}:null}case`omp`:' },
  // --- optional: also capture an IDLE (done) syzer pane at quit
  { name: 'O1 quit capture done syzer', glob: /^renderer\/assets\/store-.*\.js$/,
    from: 'for(let o of Object.values(t.agentStatusByPaneKey)){if(o.state===`done`){let t=i[o.paneKey];',
    to: 'for(let o of Object.values(t.agentStatusByPaneKey)){if(o.state===`done`&&!(o.agentType===`syzer`&&e===`quit`)){let t=i[o.paneKey];' },
];

module.exports = { patches };
