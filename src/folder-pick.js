'use strict';

const { execFile } = require('child_process');

// Yerel web arayüzü için işletim sisteminin klasör seçme penceresi. Tarayıcı tam yol veremediğinden seçim sunucuda yapılır.
const WIN_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false; WindowState="Minimized"}',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.Description = $env:SYZER_PICK_TITLE',
  '$d.ShowNewFolderButton = $true',
  'if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }',
].join('; ');

function command(platform, title) {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WIN_SCRIPT], env: { SYZER_PICK_TITLE: title } };
  if (platform === 'darwin') return { file: 'osascript', args: ['-e', `POSIX path of (choose folder with prompt ${JSON.stringify(title)})`], env: {} };
  return { file: 'zenity', args: ['--file-selection', '--directory', `--title=${title}`], env: {} };
}

// { path } seçildiyse, { path: null } iptal edildiyse; araç yoksa ERR_PICKER_UNAVAILABLE fırlatır.
function pickFolder({ platform = process.platform, title = 'Select workspace folder', execFileImpl = execFile, timeoutMs = 5 * 60 * 1000 } = {}) {
  const c = command(platform, title);
  return new Promise((resolve, reject) => {
    execFileImpl(c.file, c.args, { windowsHide: false, timeout: timeoutMs, env: { ...process.env, ...c.env } }, (err, stdout) => {
      if (err && err.code === 'ENOENT') { const e = new Error('folder picker unavailable'); e.code = 'ERR_PICKER_UNAVAILABLE'; return reject(e); }
      const raw = String(stdout || '').trim();
      const out = /^([A-Za-z]:)?[\\/]$/.test(raw) ? raw : raw.replace(/[\\/]+$/, '');
      if (out) return resolve({ path: out });
      // osascript/zenity iptalde sıfır olmayan kodla çıkar: iptal sayılır.
      return resolve({ path: null });
    });
  });
}

module.exports = { pickFolder, command };
