'use strict';

const { spawn, spawnSync } = require('child_process');

const UTF8_POWERSHELL = '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ';

let pwshFound;
function hasPwsh() {
  if (pwshFound === undefined) {
    try { pwshFound = spawnSync('where.exe', ['pwsh.exe'], { stdio: 'ignore', windowsHide: true }).status === 0; } catch { pwshFound = false; }
  }
  return pwshFound;
}

function shellSpec(command, { platform = process.platform, findPwsh = hasPwsh } = {}) {
  if (platform === 'win32') return { command: findPwsh() ? 'pwsh.exe' : 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', UTF8_POWERSHELL + command], options: {} };
  return { command: 'sh', args: ['-c', command], options: { detached: true } };
}

function spawnShell(command, cwd, options = {}) {
  const spec = shellSpec(command, options);
  return (options.spawnImpl || spawn)(spec.command, spec.args, { cwd, ...spec.options });
}

// Önce CommandLineToArgvW kurallarıyla (\" ve ters eğik çizgi), sonra cmd.exe üst karakterleri ^ ile kaçırılır.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function quoteCmdArg(value) {
  const arg = String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${arg}"`.replace(CMD_META, '^$1');
}

function cmdCommandLine(command, args = []) { return [command, ...args].map(quoteCmdArg).join(' '); }

function spawnMcp(command, args, opts, options = {}) {
  const platform = options.platform || process.platform;
  const spawnImpl = options.spawnImpl || spawn;
  if (platform === 'win32') return spawnImpl(options.comSpec || process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${cmdCommandLine(command, args)}"`], { ...opts, shell: false, windowsHide: true, windowsVerbatimArguments: true });
  return spawnImpl(command, args, { ...opts, detached: true });
}

function killTree(child, options = {}) {
  if (!child || !child.pid) return;
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    try {
      const taskkill = (options.spawnImpl || spawn)('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      if (taskkill && typeof taskkill.on === 'function') taskkill.on('error', () => {});
      if (taskkill && typeof taskkill.unref === 'function') taskkill.unref();
    } catch { /* süreç zaten bitmiş veya taskkill başlatılamadı */ }
    return;
  }
  const killImpl = options.killImpl || process.kill;
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
  const pid = child.pid;
  const exited = () => child.exitCode !== null && child.exitCode !== undefined;
  try { killImpl(-pid, 'SIGTERM'); } catch { /* süreç zaten bitmiş */ }
  const timer = setTimeoutImpl(() => { if (!exited()) { try { killImpl(-pid, 'SIGKILL'); } catch { /* süreç zaten bitmiş */ } } }, options.graceMs === undefined ? 1000 : options.graceMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  if (typeof child.once === 'function') child.once('close', () => clearTimeoutImpl(timer));
}

module.exports = { UTF8_POWERSHELL, hasPwsh, shellSpec, spawnShell, quoteCmdArg, cmdCommandLine, spawnMcp, killTree };
