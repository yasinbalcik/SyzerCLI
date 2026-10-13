'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, md, parseDiff } = require('../src/web-ui');

test('web UI keeps one HTML export and required accessibility surfaces', () => {
  assert.match(html, /String\.raw|<!doctype html>/i);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="confirm-root"/);
  assert.match(html, /data-theme=light/);
  assert.doesNotMatch(html, /https?:\/\/[^"']+\/.*(?:css|js)/i);
});

test('markdown renderer escapes HTML and renders supported blocks', () => {
  const result = md('# Başlık\n\n- biri\n- iki\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[link](https://example.com) `code` <script>alert(1)</script>');
  assert.match(result, /<h1>Başlık<\/h1>/);
  assert.match(result, /<ul>/);
  assert.match(result, /<table>/);
  assert.match(result, /target="_blank"/);
  assert.doesNotMatch(result, /<script>/);
});

test('diff parser recognizes fenced and raw tool diffs', () => {
  const rows = parseDiff('diff --git a/a b/a\n@@ -1 +1 @@\n-old\n+new');
  assert.equal(rows.find((x) => x.kind === 'add').text, '+new');
  assert.equal(rows.find((x) => x.kind === 'remove').text, '-old');
  assert.match(md('```diff\n-old\n+new\n```'), /diff-row add/);
  assert.equal(parseDiff('plain text'), null);
  assert.equal(parseDiff('diff --git a/a b/a\n-\n+new').find((x) => x.text === '-').kind, 'remove');
});

function luminance(hex) {
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
  const rgb = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255);
  const linear = rgb.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function cssVars(selector) {
  const block = html.match(new RegExp(selector + '\\{([^}]*)\\}'))?.[1] || '';
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):(#[0-9a-f]{3,6})/gi)].map((m) => [m[1], m[2]]));
}

test('critical theme text pairs meet WCAG AA contrast', () => {
  const dark = cssVars(':root'), light = cssVars('\\[data-theme=light\\]');
  assert.ok(contrast(dark['--primary-fg'], dark['--accent']) >= 4.5, 'dark primary button');
  assert.ok(contrast(light['--warn-fg'], light['--warn']) >= 4.5, 'light connection banner');
  assert.ok(contrast(light['--ok'], light['--code']) >= 4.5, 'light added diff');
  assert.ok(contrast(light['--danger'], light['--code']) >= 4.5, 'light removed diff');
  assert.equal(dark['--primary-fg'], '#0d0f12');
  assert.equal(light['--warn-fg'], '#fff');
  assert.match(html, /\.diff-row\.add\{background:rgb\(8 116 67\/.10\)/);
  assert.match(html, /\.diff-row\.remove\{background:rgb\(180 35 45\/.10\)/);
  assert.match(html, /\.primary\{[^}]*color:var\(--primary-fg\)/);
  assert.match(html, /\.connection\{[^}]*color:var\(--warn-fg\)/);
});

test('drawer focus model hides closed panels and excludes hidden tab controls', () => {
  assert.match(html, /body:not\(\.left-open\) \.left,body:not\(\.right-open\) \.right\{visibility:hidden\}/);
  assert.match(html, /!x\.disabled&&!x\.closest\('\[hidden\]'\)/);
});

test('workspace and session cards expose keyboard button behavior', () => {
  assert.equal((html.match(/role="button" tabindex="0" data-p=/g) || []).length, 1);
  assert.equal((html.match(/role="button" tabindex="0" data-id=/g) || []).length, 1);
  assert.ok((html.match(/e\.onkeydown=ev=>\{if\(ev\.key==='Enter'\|\|ev\.key===' '/g) || []).length >= 2);
});

test('browser renderer stays in parity with exported markdown and diff behavior', () => {
  assert.match(html, /\^\-\(\?!\\-\\-\\-\)/);
  assert.doesNotMatch(html, /\^\-\(\(\?!\\-\\-\\-\)\.\)/);
  assert.match(html, /replace\(\/__\(\[\^_\\n\]\+\)__\//);
  assert.match(html, /!\/\^>\\s\?\/.test\(lines\[i\]\)/);
  assert.match(html, /!\/\^\\s\*\\d\+\[\.\)\]\\s\+\/.test\(lines\[i\]\)/);
});

test('markdown handles underscore emphasis and paragraph list boundaries', () => {
  const result = md('A paragraph\n\n1. first\n2. second\n\n__bold__');
  assert.match(result, /<p>A paragraph<\/p>/);
  assert.match(result, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(result, /<strong>bold<\/strong>/);
});

test('interactive controls use at least 44px touch targets and localized labels', () => {
  assert.match(html, /\.tabs button\{[^}]*min-height:44px/);
  assert.match(html, /\.key \.remove\{[^}]*min-height:44px[^}]*min-width:44px/);
  assert.match(html, /\.composer-row select\{[^}]*min-height:44px/);
  assert.match(html, /#wsadd[^,{]*\{[^}]*min-height:44px/);
  assert.match(html, /id="m2"[^>]*data-a="model"/);
  assert.match(html, /id="e2"[^>]*data-a="effort"/);
  assert.match(html, /id="p2"[^>]*data-a="perm"/);
  assert.match(html, /id="tl"[^>]*data-a="leftPanel"/);
  assert.match(html, /id="tr"[^>]*data-a="rightPanel"/);
  assert.match(html, /id="theme-btn"[^>]*data-a="toggleTheme"/);
});

test('inline script parses cleanly without syntax errors', () => {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match, 'script tag exists');
  assert.doesNotThrow(() => {
    new Function(match[1]);
  });
});

test('desktop layout hides panel toggles that would do nothing and clamps long skill text', () => {
  assert.match(html, /@media\(min-width:1200px\)\{[^}]*#tl[^}]*#tr[^}]*display:none/);
  assert.match(html, /\.item \.desc\{[^}]*-webkit-line-clamp:3/);
});

test('activity tracking does not break the stream event chain (text must not fall to unknown)', () => {
  assert.doesNotMatch(html, /else actEvent\(e\)/);
  assert.match(html, /catch\{continue\}actEvent\(e\);if\(e\.type==='text'\)/);
});

test('line icon set, breadcrumb, collapsible activity sections and chip composer', () => {
  assert.match(html, /<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">/);
  assert.doesNotMatch(html, /id="(?:tl|theme-btn|act-btn)"[^>]*>[\u2630\u25d0\u25a5]/);
  assert.match(html, /id="crumb-ws"/);
  assert.match(html, /<span id="title"><\/span>/);
  assert.match(html, /class="ahead" aria-expanded="false"/);
  assert.match(html, /class="icon-btn plus" id="addat" data-a="mention"/);
  assert.match(html, /id="m2" class="sel-chip"/);
  assert.match(html, /ph:'Ask anything \u00b7 @ file \u00b7 \/ skill'/);
  assert.match(html, /ph:'\u0130stedi\u011fini sor|ph:'\u0130stedi\u011fini sor \u00b7 @ dosya \u00b7 \/ beceri'/);
});
