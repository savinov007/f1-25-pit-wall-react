# AGENTS.md

Guidance for anyone (human or AI agent) changing this repository.

## What this is

A live F1 25 telemetry dashboard ("Pit Wall") built on the `f1-udp-parser` TypeScript library in `src/`.

| Path | Role |
| --- | --- |
| `src/` | UDP packet parser library (TypeScript, compiled to `build/` by `npm run compile`) |
| `server.js` | `createDashboard()`: HTTP for the page, WebSocket state pushes, UDP telemetry or demo data, recording |
| `strategy.js` | Strategy models measured from live data (tyre wear rate, pace trend, gap trend, pit loss) |
| `replay.js`, `listen.js` | Recording file format (read and write), replay a recording to UDP; console-only listener |
| `scripts/compress-recordings.js` | Converts old plain `.jsonl` recordings to compressed `.f1rec`, verified packet by packet |
| `scripts/build-tracks.js`, `scripts/fetch-official-corners.js` | Build the shipped track maps (`public/tracks/`) from recordings; fetch the official corner data (`tracks/official.json`) |
| `public/lib.js` | Pure dashboard logic (formatting, projections, map/trace helpers), shared by page and tests |
| `public/app.js`, `layout.js`, `popup.js` | Page rendering, resizable sections, floating rival popup |
| `test/` | Tests (Node's built-in runner); `test/fixtures/` holds real F1 25 packets |

Run it with `npm start` (live, UDP 20777), `npm run demo` (synthetic data) or `npm run replay:dash -- recordings/<file>.f1rec` (play a recording with on-page controls), then open http://localhost:3000.

## Rule: new functionality comes with tests

**Every new feature, behaviour change or bug fix must include tests in `test/` that would fail without the change.**

- A new feature gets tests for its normal behaviour and its edge cases (missing data, limits, invalid input).
- A bug fix gets a regression test that reproduces the bug.
- Changing existing behaviour means updating the tests that describe it, not deleting them.
- Don't weaken or skip a failing test to get a change through. Fix the code, or fix the test if it was wrong, and say which.

Run `npm test` before committing. A husky **pre-push** hook runs it too and blocks the push if anything fails. Don't bypass it with `--no-verify`.

`npm run test:coverage` prints line/branch coverage. Keep the server-side files (`server.js`, `strategy.js`, `replay.js`, `listen.js`, `public/lib.js`) at or near 100% line coverage.

## Where tests go

| Change in | Test file | How |
| --- | --- | --- |
| `strategy.js` | `test/strategy.test.js` | Feed synthetic lap arrays to `StrategyTracker`, compare with known answers |
| `public/lib.js` | `test/lib.test.js` | Plain function calls (`require('../public/lib')`) |
| `src/` parsing | `test/parser.test.js` | Parse `fixturePackets()` (real F1 25 packets) |
| `server.js` | `test/server.test.js` | `createDashboard({httpPort: 0, udpPort: 0, recDir: tmp, log: quiet})`; feed packets with `handlePacket()` or real UDP; always `stop()` |
| `replay.js`, `listen.js` | `test/replay.test.js`, `test/listen.test.js` | Exported functions, plus the command line via `spawn` |
| `scripts/compress-recordings.js` | `test/replay.test.js` | `compressRecording()` / `main()` on copies of the fixture in the temp dir |
| `scripts/build-tracks.js`, `scripts/fetch-official-corners.js` | `test/tracks.test.js` | The fixture with lowered `trackComplete` limits; a fake `fetchJson` (no network) |
| `public/app.js` (page) | `test/ui.test.js` | `loadPage()` from `test/helpers.js`; `push(dashboardState({...}))`; assert on the DOM and on `sent()` messages |
| `public/layout.js` | `test/layout.test.js` | `loadPage()`; stub `getBoundingClientRect`; drive pointer/keyboard events |
| `public/popup.js` | `test/popup.test.js` | `loadPage({width, height})`; drive pointer events |

Helpers in `test/helpers.js`:

- `fixturePackets()`: 321 real F1 25 packets (Catalunya, 10 cars, 13 packet types).
- `dashboardState(overrides)`: a full server message built from the demo generator.
- `loadPage(options)`: the real page in jsdom with a fake WebSocket and canvas. `p.eval('name')` reads top-level page variables, `p.drawLog` records canvas calls.

## Writing code that stays testable

- Put logic that doesn't need the DOM in `public/lib.js` (or a server-side module) as pure functions taking their inputs as arguments, and keep `app.js` to wiring and rendering.
- New server behaviour belongs inside `createDashboard()`, configurable through its options, never through module-level state.
- Tests must not depend on fixed ports, the network, real time-of-day or files outside a temp dir. Use port `0`, `fs.mkdtempSync`, and close everything (dashboards, sockets, jsdom pages) even when an assertion fails.
- If a test needs real game data that the fixture lacks, cut a small new fixture from a recording rather than committing a full recording (`recordings/` is git-ignored).

## Commits

Commit each feature or fix and its tests as separate commits, with messages that say what changed and why.
