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
});
