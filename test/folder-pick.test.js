const test = require('node:test');
const assert = require('node:assert/strict');
const { pickFolder, command } = require('../src/folder-pick');

const fake = (stdout, err = null) => (file, args, opts, cb) => { fake.seen = { file, args, opts }; cb(err, stdout); };

test('folder-pick: Windows uses an STA PowerShell FolderBrowserDialog and returns the chosen path', async () => {
  const r = await pickFolder({ platform: 'win32', title: 'Çalışma alanı', execFileImpl: fake('C:\\Users\\ROOT\\proj\r\n') });
  assert.deepEqual(r, { path: 'C:\\Users\\ROOT\\proj' });
  assert.equal(fake.seen.file, 'powershell.exe');
  assert.ok(fake.seen.args.includes('-STA'));
  assert.match(fake.seen.args.at(-1), /FolderBrowserDialog/);
  assert.equal(fake.seen.opts.env.SYZER_PICK_TITLE, 'Çalışma alanı');
});

test('folder-pick: keeps drive roots and trims trailing separators elsewhere', async () => {
  assert.deepEqual(await pickFolder({ platform: 'win32', execFileImpl: fake('D:\\\n') }), { path: 'D:\\' });
  assert.deepEqual(await pickFolder({ platform: 'linux', execFileImpl: fake('/home/y/proj/\n') }), { path: '/home/y/proj' });
});

test('folder-pick: cancel resolves with null path, missing tool is a coded error', async () => {
  assert.deepEqual(await pickFolder({ platform: 'darwin', execFileImpl: fake('', Object.assign(new Error('x'), { code: 1 })) }), { path: null });
  await assert.rejects(pickFolder({ platform: 'linux', execFileImpl: fake('', Object.assign(new Error('x'), { code: 'ENOENT' })) }), { code: 'ERR_PICKER_UNAVAILABLE' });
});

test('folder-pick: title is passed as data, not spliced into the PowerShell script', () => {
  const c = command('win32', '"; Remove-Item C:\\ -Recurse; "');
  assert.doesNotMatch(c.args.at(-1), /Remove-Item/);
});
