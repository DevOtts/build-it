// Entry so `node --test tests/status/` works on Node 22 (a bare directory argument resolves to index.js).
// Loads every *.test.mjs in this folder into the one test run. Authored by DevOtts.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
    await import(pathToFileURL(path.join(__dirname, f)).href);
  }
})();
