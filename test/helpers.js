// Shared test helpers: the real-packet fixture. The page's own tests (React, Vitest) live in web/test.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'catalunya-f125.jsonl');

// Real F1 25 packets (Catalunya, 10 cars) cut from a session recording: [{t, buf}] in arrival order.
function fixturePackets() {
  const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).slice(1);
  return lines.map(l => {
    const [t, b64] = JSON.parse(l);
    return {t, buf: Buffer.from(b64, 'base64')};
  });
}

module.exports = {ROOT, FIXTURE, fixturePackets};
