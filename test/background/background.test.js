'use strict';
// Runs src/background/*.js in a shared vm.Context with the fakes from
// harness.js, then drives scenarios.js through it. A vm.Context (not require())
// is what makes this work: the background scripts are classic scripts, not
// modules, and rely on sharing one global scope across files exactly like the
// <script> tags Thunderbird loads them as (see AGENTS.md). require() would give
// each file its own module scope and break that.
// Run: node --test test/background/background.test.js
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
}

async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

test('background scenarios', async () => {
  const sandbox = {};
  const context = vm.createContext(sandbox);
  const run = (code, filename) => vm.runInContext(code, context, { filename });

  run(fs.readFileSync(path.join(__dirname, 'harness.js'), 'utf8'), 'harness.js');

  const manifest = JSON.parse(readSrc('manifest.json'));
  for (const script of manifest.background.scripts) {
    if (script === 'lib/filesender.js') continue; // faked in harness.js
    run(readSrc(script), script);
  }

  run(fs.readFileSync(path.join(__dirname, 'scenarios.js'), 'utf8'), 'scenarios.js');

  const n = sandbox.steps.length;
  for (let i = 0; i < n; i++) {
    await settle();
    sandbox.steps[i]();
  }
  await settle();

  const checks = sandbox.checks;
  assert.ok(checks.length > 0, 'no scenario checks ran');
  for (const c of checks) {
    assert.ok(c.ok, c.name + (c.ok ? '' : ' -- ' + JSON.stringify(c.detail)));
  }
});
