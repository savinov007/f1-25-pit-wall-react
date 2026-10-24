const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('every image the README links to exists and is a PNG', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(images.length >= 6, 'the README shows the dashboard, popup, compare, waiting, replays and replay');
  for (const img of images) {
    const file = path.join(ROOT, img);
    assert.ok(fs.existsSync(file), `${img} is missing`);
    assert.deepEqual([...fs.readFileSync(file).subarray(1, 4)], [0x50, 0x4e, 0x47], `${img} is not a PNG`);
  }
});

test('the commands the README gives exist as npm scripts', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  for (const name of new Set([...readme.matchAll(/npm run ([\w:]+)/g)].map(m => m[1]))) {
    assert.ok(scripts[name], `npm run ${name} is not in package.json`);
  }
});
