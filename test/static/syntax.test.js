'use strict';
// Parses every src/**/*.js file without executing it (vm.Script compiles but
// never runs), catching syntax errors the way test/static/static_check.py used
// to with JavaScriptCore. Run: node --test test/static/syntax.test.js
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function findJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = findJsFiles(path.join(ROOT, 'src')).sort();

test('every src/**/*.js file parses', async (t) => {
  assert.ok(files.length > 0, 'no JS files found under src/');
  for (const file of files) {
    await t.test(path.relative(ROOT, file), () => {
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
    });
  }
});
