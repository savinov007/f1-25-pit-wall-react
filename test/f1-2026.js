// Builds UDP format 2026 packets (F1 25: 2026 Season Pack, spec v1.2) byte by byte from the spec's
// struct definitions, so parser tests don't depend on a recording. Sizes must match the spec's table.
const CARS = 24;

class Writer {
  constructor() { this.parts = []; }
  push(size, write) { const b = Buffer.alloc(size); write(b); this.parts.push(b); return this; }
  u8(v) { return this.push(1, b => b.writeUInt8(v & 0xff)); }
  i8(v) { return this.push(1, b => b.writeInt8(v)); }
  u16(v) { return this.push(2, b => b.writeUInt16LE(v)); }
  i16(v) { return this.push(2, b => b.writeInt16LE(v)); }
  u32(v) { return this.push(4, b => b.writeUInt32LE(v)); }
  u64(v) { return this.push(8, b => b.writeBigUInt64LE(BigInt(v))); }
  f32(v) { return this.push(4, b => b.writeFloatLE(v)); }
  f64(v) { return this.push(8, b => b.writeDoubleLE(v)); }
  str(s, len) { return this.push(len, b => b.write(s, 'utf8')); }
  repeat(n, fn) { for (let i = 0; i < n; i++) fn(i); return this; }
  buffer() { return Buffer.concat(this.parts); }
}

const SESSION_UID = 0x1234567890abcdefn;

function header(w, packetId, {playerIdx = 0} = {}) {
  return w.u16(2026).u8(25).u8(1).u8(26).u8(1).u8(packetId).u64(SESSION_UID).f32(123.5).u32(1000).u32(1001).u8(playerIdx).u8(255);
}

// 24 cars: the player is car 0; teams use the 2026 uint16 ids (476 Mercedes '26 ... 486 Cadillac '26)
const TEAM_IDS = [476, 476, 477, 477, 478, 478, 479, 479, 480, 480, 481, 481, 482, 482, 483, 483, 484, 484, 485, 485, 486, 486, 41, 104];
const NAMES = Array.from({length: CARS}, (_, i) => (i === 0 ? 'Windman999' : `DRIVER${i}`));

function motion() {
  const w = header(new Writer(), 0);
  w.repeat(CARS, i => {
    w.f32(100 + i).f32(5).f32(-200 - i).f32(10).f32(0).f32(20)
      .i16(0).i16(0).i16(32767).i16(32767).i16(0).i16(0)
      .i16(1234 + i).i16(-2500).i16(1000) // g-forces quantised: thousandths of a G
      .f32(0.1).f32(0.2).f32(0.3);
  });
  return w.buffer();
}

function session() {
  const w = header(new Writer(), 1);
  w.u8(1).i8(31).i8(24).u8(57).u16(5476).u8(15).i8(42).u8(0) // weather, temps, laps, length, race, Madrid, F1 Modern
    .u16(3600).u16(7200).u8(80).u8(0).u8(0).u8(255).u8(0)
    .u8(3).repeat(21, k => w.f32(k / 21).i8(0))
    .u8(0).u8(1).u8(2)
    .repeat(64, () => w.u8(15).u8(0).u8(1).i8(31).i8(2).i8(24).i8(2).u8(10))
    .u8(0).u8(90).u32(1).u32(2).u32(3)
    .u8(20).u8(26).u8(9) // pit window ideal/latest lap, rejoin position
    .repeat(9, () => w.u8(0)) // assists
    .u8(28).u8(1).u32(840).u8(7)
    .repeat(7, () => w.u8(0)) // units, safety car / VSC / red flag counts
    .repeat(24, () => w.u8(0)) // equal performance ... affects licence level MP
    .u8(3).repeat(12, k => w.u8(k < 3 ? 15 : 0))
    .f32(1800).f32(3600)
    // 2026: active aero / DRS zones, reaction time, new assists
    .u8(0)
    .u8(2).repeat(8, k => (k < 2 ? w.f32(0.1 + k * 0.5).f32(0.2 + k * 0.5) : w.f32(0).f32(0)))
    .u8(1).repeat(8, k => (k < 1 ? w.f32(0.6).f32(0.7) : w.f32(0).f32(0)))
    .u8(1).repeat(4, k => (k < 1 ? w.f32(0.85).f32(0.95) : w.f32(0).f32(0)))
    .f32(0.214)
    .u8(1).u8(2).u8(1).u8(3).u8(1);
  return w.buffer();
}

function lapData() {
  const w = header(new Writer(), 2);
  w.repeat(CARS, i => {
    w.u32(90000 + i * 100).u32(30000).u16(25000).u8(0).u16(30000).u8(0)
      .u16(i ? 800 : 0).u8(0).u16(i * 900).u8(0)
      .f32(1200 + i).f32(6676 + i).f32(0)
      .u8(i + 1).u8(2).u8(0).u8(0).u8(1).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0)
      .u8(i + 1).u8(4).u8(2) // grid, driver status on track, result active
      .u8(0).u16(0).u16(0).u8(0).f32(320 + i).u8(1);
  });
  return w.u8(255).u8(255).buffer();
}

function participants() {
  const w = header(new Writer(), 4).u8(CARS);
  w.repeat(CARS, i => {
    w.u8(i === 0 ? 0 : 1).u16(i === 0 ? 65535 : 300 + i).u16(i).u16(TEAM_IDS[i]).u8(0).u8(i + 1).u8(10)
      .str(NAMES[i], 32).u8(1).u8(1).u16(0).u8(255).u8(1).repeat(4, () => w.u8(255).u8(0).u8(0));
  });
  return w.buffer();
}

function carSetups() {
  const w = header(new Writer(), 5);
  w.repeat(CARS, () => {
    w.u8(20).u8(18).u8(60).u8(50).f32(-3).f32(-1.5).f32(0.05).f32(0.2)
      .u8(20).u8(10).u8(6).u8(5).u8(30).u8(60).u8(100).u8(56).u8(50)
      .f32(22).f32(22).f32(24).f32(24).u8(0).f32(30);
  });
  return w.f32(21).buffer();
}

function carTelemetry() {
  const w = header(new Writer(), 6);
  w.repeat(CARS, i => {
    w.u16(250 + i).f32(1).f32(-0.25).f32(0).u8(0).i8(7).u16(11000 + i).u8(0).u8(60).u16(0x7fff)
      .repeat(4, k => w.u16(500 + k)).repeat(4, k => w.u8(90 + k)).repeat(4, k => w.u8(100 + k))
      .u8(112) // engine temperature: uint8 in 2026
      .repeat(4, k => w.f32(23 + k * 0.5)).repeat(4, () => w.u8(0));
  });
  return w.u8(255).u8(255).i8(0).buffer();
}

function carStatus() {
  const w = header(new Writer(), 7);
  w.repeat(CARS, i => {
    w.u8(0).u8(0).u8(1).u8(56).u8(0).f32(30 - i).f32(110).f32(1.5).u16(13000).u16(4000).u8(8).u8(0).u16(0)
      .u8(18).u8(17).u8(3).i8(0).f32(550000).f32(120000).f32(3000000).u8(3)
      .f32(1000000).f32(0)
      .f32(8500000) // 2026: ERS harvest limit per lap (J)
      .f32(2000000).u8(0);
  });
  return w.buffer();
}

function finalClassification() {
  const w = header(new Writer(), 8).u8(CARS);
  w.repeat(CARS, i => {
    w.u8(i + 1).u8(57).u8(i + 1).u8(0).u8(1).u8(3).u8(2).u32(88000 + i).f64(5400 + i).u8(0).u8(0).u8(2)
      .repeat(8, () => w.u8(18)).repeat(8, () => w.u8(17)).repeat(8, () => w.u8(20));
  });
  return w.buffer();
}

function lobbyInfo() {
  const w = header(new Writer(), 9).u8(CARS);
  w.repeat(CARS, i => {
    w.u8(1).u16(TEAM_IDS[i]).u8(10).u8(255).str(NAMES[i], 32).u8(i + 1).u8(1).u8(1).u16(0).u8(1);
  });
  return w.buffer();
}

function carDamage() {
  const w = header(new Writer(), 10);
  w.repeat(CARS, i => {
    w.repeat(4, k => w.f32(10 + i + k)).repeat(4, () => w.u8(0)).repeat(4, () => w.u8(0)).repeat(4, () => w.u8(0))
      .u8(i === 1 ? 25 : 0).repeat(16, () => w.u8(0)).u8(0); // 18 uint8 fields: FL wing (25% on car 1) ... engine seized
  });
  return w.buffer();
}

function timeTrial() {
  const w = header(new Writer(), 14);
  w.repeat(3, () => w.u8(0).u16(485).u32(80000).u32(25000).u32(28000).u32(27000).u8(0).u8(0).u8(0).u8(0).u8(0).u8(1));
  return w.buffer();
}

function lapPositions() {
  const w = header(new Writer(), 15).u8(2).u8(0);
  w.repeat(50, lap => w.repeat(CARS, i => w.u8(lap < 2 ? i + 1 : 0)));
  return w.buffer();
}

function carTelemetry2() {
  const w = header(new Writer(), 16);
  w.repeat(CARS, i => {
    w.u8(i % 2) // active aero: 0 corner, 1 straight
      .u8(1).u16(i % 2 ? 0 : 150)
      .u8(i === 0 ? 1 : 0).u8(i === 0 ? 1 : 0).u16(i === 0 ? 0 : 400)
      .u8(1).u8(i === 23 ? 1 : 0); // 2026 regulations; car 23 driving the wrong way
  });
  return w.buffer();
}

function collisionEvent() {
  return header(new Writer(), 3).str('COLL', 4).u8(3).u8(5).u8(2).buffer();
}

const BUILDERS = {
  motion, session, lapData, participants, carSetups, carTelemetry, carStatus, finalClassification,
  lobbyInfo, carDamage, timeTrial, lapPositions, carTelemetry2, event: collisionEvent,
};

// Official packet sizes from the spec's packet descriptions
const SPEC_SIZES = {
  motion: 1325, session: 926, lapData: 1399, event: 45, participants: 1470, carSetups: 1233, carTelemetry: 1448,
  carStatus: 1445, finalClassification: 1134, lobbyInfo: 1062, carDamage: 1133, timeTrial: 104, lapPositions: 1231,
  carTelemetry2: 269,
};

// event packets are padded to the full 45 bytes like the game sends them
function build(name) {
  const buf = BUILDERS[name]();
  return name === 'event' ? Buffer.concat([buf, Buffer.alloc(SPEC_SIZES.event - buf.length)]) : buf;
}

module.exports = {build, BUILDERS, SPEC_SIZES, TEAM_IDS, NAMES, CARS, SESSION_UID};
