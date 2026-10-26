# Pit Wall: live F1 telemetry dashboard

A live telemetry dashboard for **F1 25** and **F1 26** (the F1 25 2026 Season Pack, UDP Format 2026), built on the UDP parser library below. Point the game's telemetry at your machine, open `http://localhost:3000`, and get a pit wall in the browser: driving traces, tyres and damage, lap timing, a track map built from the cars' own positions, standings with strategy models, and per-driver telemetry for everyone on track.

![Dashboard](docs/dashboard.png?v=3)

## Quick start

```
$ npm run setup            # installs the server and the page (web/)
$ npm start                # live: listens for the game on UDP 20777
$ npm run demo             # synthetic data, no game needed
$ npm run replay:dash -- recordings/<file>.f1rec   # play back a recording
```

Then open http://localhost:3000. The first screen asks which format the game sends (F1 26 / UDP Format 2026, or F1 25) and shows the settings to enter in the game: **Settings → Telemetry Settings**, UDP Telemetry **On**, your machine's IP address (or `127.0.0.1` if the game runs on the same machine), port **20777**, 20 Hz.

![Waiting screen](docs/waiting.png?v=3)

## Features

- **Driving**: speed, gear, RPM and shift lights, throttle, brake and steering with a rolling trace, and the ERS **battery** (green with charge, red when nearly empty, glowing blue with overtake mode) with the ERS mode under it. The 2026 active-aero mode (STRAIGHT / CORNER) is next to it; pre-2026 cars show DRS.
- **Tyres and car**: surface and inner temperatures, pressure and wear per tyre with wear colour bands, fuel, ERS, and a damage map.
- **Lap timing and header**: current, last and best lap, sectors, position, and a session chip with the session type, lap (of the total in a race) and time left.
- **Track map**: built from every car's world position, so it works while you sit in the pits. Rivals are dots with labels; 2026 active-aero and DRS zones are drawn on the outline.
- **Standings**: team colours, LAST / BEST toggle with the delta to the fastest lap, interval or gap to the leader, tyre compound, and tags for pit, flying and out laps, penalties, overtake mode and wrong-way driving.
- **Strategy models**: tyre wear rate and laps until a wear limit, pace trend, gap trend to the cars ahead and behind, measured pit loss and where you would rejoin.
- **Rival popup**: click a driver for a floating, draggable, resizable window with their full telemetry.
- **Compare mode**: up to four drivers side by side, with a live trace chart or a lap-synced chart to see the difference at the same corner.
- **Custom layout**: the Layout button opens a dialog where you drag sections into up to four columns, in any order
  (arrow keys work too); drag the dividers between sections to resize them. Both are remembered.
- **Recording and replay**: the REC button saves the raw packets, compressed losslessly (about 12× smaller); the **Replays** button lists saved recordings and opens one in a new tab with a floating player (play / pause, seek, ±10 s, loop, 0.25× to 10×).
- **F1 26 support**: 24 cars, 16-bit team IDs (including Audi and Cadillac), quantised g-forces, active aero, overtake mode, the new events and the Madrid circuit. Parsed against the official spec, byte for byte.

![Rival popup](docs/rival-popup.png?v=3)

![Compare mode](docs/compare.png?v=3)

Switch the chart to **lap distance** to line the drivers up corner by corner, here comparing throttle over the last lap:

![Compare mode, throttle by lap distance](docs/compare-lap.png?v=3)

### Replay

Recordings are written to `recordings/` (git-ignored). Open the list from the header's **Replays** button (or the waiting screen), pick one, and it plays in a new tab:

![Saved replays](docs/replays.png?v=3)

![Replay mode](docs/replay.png?v=3)

You can also start one from the command line with `npm run replay:dash -- recordings/<file>.f1rec`, or send a recording to a running dashboard over UDP with `npm run replay -- recordings/<file>.f1rec [--speed 2] [--loop]`.

Recordings are `.f1rec` files: a plain JSON header line, then the packets brotli-compressed as they arrive (flushed every 2 s, so a crash loses at most that). A 34-minute online race is about 39 MB instead of 450 MB. Older plain `.jsonl` recordings still play; `npm run recordings:compress` converts them, checking every packet against the original before removing it (`-- --keep` keeps the originals).

## Development

```
$ npm test                       # runs the whole suite (also runs before every push)
$ npm run test:coverage
$ npm run demo                   # in one terminal: the server with synthetic data
$ npm run dev:web                # in another: the page with hot reload on http://localhost:5173
$ npm run build:web && node scripts/screenshots.js    # regenerates docs/*.png (needs Google Chrome)
```

The page is a React + TypeScript app in `web/` (Vite, Zustand), built into `web/dist` and served by `server.js`. Server messages arrive about 30 times a second: each part of the page subscribes only to the fields it shows, and the charts draw from buffers on animation frames, so a message never re-renders more than what changed.

New functionality comes with tests; see [AGENTS.md](AGENTS.md) for the layout of the repo and the rules.

---

# F1 UDP Parser (library)

The F1 series of games support the outputting of key game data via a UDP data stream. This data can be interpreted by external apps or connected peripherals for a range of different uses, including providing additional telemetry information, customised HUD displays, motion platform hardware support or providing force feedback data for custom steering wheels.

This is a TypeScript UDP client and telemetry parser for EA - Codemaster's F1 2022, F1 23, F1 24, F1 25 and F1 26 (UDP Format 2026).

## Installing

```
$ npm install @deltazeroproduction/f1-udp-parser
```

or

```
$ yarn add @deltazeroproduction/f1-udp-parser
```

## Running the parser

```
$ npm run start
```

or

```
$ yarn start
```

## Usage

```
import { F1TelemetryClient, constants } from "f1-telemetry-client";
// or: const { F1TelemetryClient, constants } = require('f1-telemetry-client');
const { PACKETS } = constants;

/*
*   'port' is optional, defaults to 20777
*   'forwardAddresses' is optional, it's an array of Address objects to forward unparsed telemetry to. each address object is comprised of a port and an optional ip address
*                   defaults to undefined
*   'skipParsing' is optional, setting it to true will make the client not parse and emit content. You can consume telemetry data using forwardAddresses instead.
*                   defaults to false
*/
const client = new F1TelemetryClient({ port: 20777 });
client.on(PACKETS.event, console.log);
client.on(PACKETS.motion, console.log);
client.on(PACKETS.carSetups, console.log);
client.on(PACKETS.lapData, console.log);
client.on(PACKETS.session, console.log);
client.on(PACKETS.participants, console.log);
client.on(PACKETS.carTelemetry, console.log);
client.on(PACKETS.carStatus, console.log);
client.on(PACKETS.finalClassification, console.log);
client.on(PACKETS.lobbyInfo, console.log);
client.on(PACKETS.carDamage, console.log);
client.on(PACKETS.sessionHistory, console.log);
client.on(PACKETS.tyreSets, console.log); // F1 23 and 24 only
client.on(PACKETS.motionEx, console.log); // F1 23 and 24 only
client.on(PACKETS.timeTrial, console.log); // F1 24 only
client.on(PACKETS.lapPositions, console.log); // F1 25 only

// to start listening:
client.start();

// and when you want to stop:
client.stop();
```

## Documentation

The following links contain information that summarises the UDP data structures so that developers of supporting hardware or software are able to configure these to work correctly with the F1 game.

[F1 2022 UDP Spec](https://answers.ea.com/t5/General-Discussion/F1-22-UDP-Specification/td-p/11551274)

[F1 23 UDP Spec](https://answers.ea.com/t5/General-Discussion/F1-23-UDP-Specification/m-p/12633159)

[F1 24 UDP Spec](https://answers.ea.com/t5/General-Discussion/F1-24-UDP-Specification/m-p/13745220)

[F1 25 UDP Spec](https://forums.ea.com/blog/f1-games-game-info-hub-en/ea-sports%E2%84%A2-f1%C2%AE25-udp-specification/12187347)

## License

Licensed under the MIT License.
