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
| `scripts/build-tracks.js`, `scripts/fetch-official-corners.js` | Build the shipped track maps (`tracks/maps/`) from recordings; fetch the official corner data (`tracks/official.json`) |
| `shared/` | Pure dashboard logic in TypeScript (formatting, projections, map/trace helpers, message types), used by the page, the server (compiled to `build/shared` by `npm run compile`) and the tests |
| `web/` | The page: React + TypeScript (Vite, Zustand). Its own package: `npm --prefix web install`, built to `web/dist` by `npm run build:web` and served by `server.js` |
| `web/src/store/` | State: `dashboard.ts` (the latest server message), `ui.ts` (settings and open windows), `layout.ts` (arrangement and sizes) |
| `web/src/telemetry/buffers.ts`, `web/src/charts/` | Time series built from the messages, and the canvas drawings (pure functions) |
| `web/src/components/` | Panels, the rival popup, compare mode, layout, replay controls, overlays |
| `test/` | Server-side tests (Node's built-in runner); `test/fixtures/` holds real F1 25 packets |
| `web/test/` | Page tests (Vitest, Testing Library, jsdom) |

Install with `npm run setup`. Run it with `npm start` (live, UDP 20777), `npm run demo` (synthetic data) or `npm run replay:dash -- recordings/<file>.f1rec` (play a recording with on-page controls), then open http://localhost:3000. While working on the page, run `npm run demo` and `npm run dev:web` (hot reload on http://localhost:5173, proxied to the server).

## Rule: new functionality comes with tests

**Every new feature, behaviour change or bug fix must include tests in `test/` that would fail without the change.**

- A new feature gets tests for its normal behaviour and its edge cases (missing data, limits, invalid input).
- A bug fix gets a regression test that reproduces the bug.
- Changing existing behaviour means updating the tests that describe it, not deleting them.
- Don't weaken or skip a failing test to get a change through. Fix the code, or fix the test if it was wrong, and say which.

Run `npm test` before committing (it runs the server tests, then `npm run test:web`). A husky **pre-push** hook runs it too and blocks the push if anything fails. Don't bypass it with `--no-verify`.

`npm run test:coverage` prints line/branch coverage. Keep the server-side files (`server.js`, `strategy.js`, `replay.js`, `listen.js`, `shared/`) at or near 100% line coverage.

## Where tests go

| Change in | Test file | How |
| --- | --- | --- |
| `strategy.js` | `test/strategy.test.js` | Feed synthetic lap arrays to `StrategyTracker`, compare with known answers |
| `shared/` | `test/lib.test.js` | Plain function calls (`require('../build/shared')`) |
| `src/` parsing | `test/parser.test.js` | Parse `fixturePackets()` (real F1 25 packets) |
| `server.js` | `test/server.test.js` | `createDashboard({httpPort: 0, udpPort: 0, recDir: tmp, log: quiet})` (`offline()` also gives it a stand-in built page); feed packets with `handlePacket()` or real UDP; always `stop()` |
| `replay.js`, `listen.js` | `test/replay.test.js`, `test/listen.test.js` | Exported functions, plus the command line via `spawn` |
| `scripts/compress-recordings.js` | `test/replay.test.js` | `compressRecording()` / `main()` on copies of the fixture in the temp dir |
| `scripts/build-tracks.js`, `scripts/fetch-official-corners.js` | `test/tracks.test.js` | The fixture with lowered `trackComplete` limits; a fake `fetchJson` (no network) |
| `web/src/components/`, stores | `web/test/app.test.tsx` | `boot()` from `web/test/helpers.tsx`; `push(dashboardState({...}))`; assert on the DOM and on `sent()` messages |
| `web/src/components/layout/` | `web/test/layout.test.tsx` | `boot()`; stub `getBoundingClientRect`; drive pointer/keyboard events |
| `web/src/hooks/useFloatingRect.ts` (rival popup) | `web/test/popup.test.tsx` | `boot({width, height})`; drive pointer events |
| `web/src/charts/` | `web/test/charts.test.ts` | Call the draw function with `fakeContext()`; assert on the logged canvas calls |
| `web/src/styles.css` | `web/test/styles.test.ts` | Match the rules behaviour depends on |

Helpers:

- `fixturePackets()` (`test/helpers.js`): 321 real F1 25 packets (Catalunya, 10 cars, 13 packet types).
- `dashboardState(overrides)` (`web/test/helpers.tsx`): a full server message built from the server's demo generator.
- `boot(options)` (`web/test/helpers.tsx`): the real page rendered in jsdom with a fake WebSocket and fresh stores; `push()`, `click()`, `key()`, `pointer()`, `sent()`.

## Writing code that stays testable

- Put logic that doesn't need the DOM in `shared/` (or a server-side module) as pure functions taking their inputs as arguments; keep components to rendering, and canvas drawing in `web/src/charts/` as pure functions of their input.
- Components subscribe to the fields they show with `useServer(s => ...)` (return primitives or a flat object of them), not to the whole message; data only drawn on a canvas goes in `telemetry/buffers.ts`, not in React state.
- Settings that are remembered keep their existing localStorage keys (`web/src/storage.ts`), so saved settings survive updates.
- New server behaviour belongs inside `createDashboard()`, configurable through its options, never through module-level state.
- Tests must not depend on fixed ports, the network, real time-of-day or files outside a temp dir. Use port `0`, `fs.mkdtempSync`, and close everything (dashboards, sockets, jsdom pages) even when an assertion fails.
- If a test needs real game data that the fixture lacks, cut a small new fixture from a recording rather than committing a full recording (`recordings/` is git-ignored).

## Commits

Commit each feature or fix and its tests as separate commits, with messages that say what changed and why.
