'use strict';

// node.exe kopyasının ikon ve sürüm bilgisini (görev yöneticisinde görünen ad/logo) SyzerCLI ile değiştirir.
// postject'ten ÖNCE çalışmalı: SEA blob eklendikten sonra kaynak tablosunu yeniden yazmak exe'yi bozar.
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');
const pkg = require('../package.json');

function brand(exe) {
  const bin = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true }) // node.exe imzalı; değişince imza zaten geçersiz olur;
  const res = ResEdit.NtExecutableResource.from(bin);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'assets', 'syzer.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, ico.icons.map((i) => i.data));

  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [maj, min, pat] = pkg.version.split('.').map((n) => parseInt(n, 10) || 0);
  vi.setFileVersion(maj, min, pat, 0, lang);
  vi.setProductVersion(maj, min, pat, 0, lang);
  vi.setStringValues({ lang, codepage: 1200 }, {
    FileDescription: 'Syzer Code',
    ProductName: 'Syzer Code',
    InternalName: 'syzer',
    OriginalFilename: 'syzer.exe',
    CompanyName: 'SyzerCLI',
    LegalCopyright: 'MIT License',
    FileVersion: pkg.version,
    ProductVersion: pkg.version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(bin);
  fs.writeFileSync(exe, Buffer.from(bin.generate()));
}

module.exports = brand;
