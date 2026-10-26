// Stylesheet rules that behaviour depends on. Ported from test/ui.test.js.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');

describe('stylesheet', () => {
  test('the hidden attribute always wins over display set in CSS', () => {
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
  test('header and main stay direct flex children of body although React mounts into #root', () => {
    expect(css).toMatch(/#root\s*\{\s*display:\s*contents/);
  });
  test('the replay list overlay does not reuse the tyre callout class "rl" (rear left)', () => {
    expect(css, 'a bare .rl rule would hit the rear-left tyre callout').not.toMatch(/^\.rl\s*\{/m);
  });
  test('the battery glows when blue, faster while boosting', () => {
    expect(css).toMatch(/\.bat\.ot \.batbody\s*\{\s*animation:\s*batglow/);
    expect(css).toMatch(/\.bat\.ot\.boost \.batbody\s*\{\s*animation:\s*batglow 0\.7s/);
    expect(css).toMatch(/@keyframes batglow/);
  });
  test('ERS mode label colours: medium green, hotlap amber, boost cyan', () => {
    const last = (mode: string) => [...css.matchAll(new RegExp(`\\.batlbl\\[data-mode="${mode}"\\][^{]*\\{\\s*color:\\s*var\\(--(\\w+)\\)`, 'g'))].pop()![1];
    expect(last('medium')).toBe('green');
    expect(last('hotlap')).toBe('amber');
    expect(last('boost')).toBe('cyan');
  });
  test('RPM and battery are sized up in compare columns and the popup', () => {
    for (const re of [/\.ccrpm\s*\{\s*font-size:\s*clamp\(20px/, /\.ccspeed \.bat\s*\{\s*width:\s*clamp\(84px/, /\.dmbox \.bat\s*\{\s*width:\s*clamp\(70px/, /\.dmbox \.rpmv\s*\{\s*font-size:\s*clamp\(22px/]) {
      expect(css).toMatch(re);
    }
  });
  test('the aero badge sits clear of the battery and its mode label', () => {
    expect(css).toMatch(/\.bat ~ \.drs\.aero[^{]*\{\s*margin-top:\s*12px/);
  });
});
