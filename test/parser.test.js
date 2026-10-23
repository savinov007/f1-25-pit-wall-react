// The dashboard relies on the parser library reading F1 25 packets correctly: these run real packets through it.
const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');
const {F1TelemetryClient, constants} = require('../build/src');
const {fixturePackets} = require('./helpers');

const {PACKETS} = constants;
let latest; // packet name -> last parsed packet
let counts;

before(() => {
  latest = {};
  counts = {};
  for (const {buf} of fixturePackets()) {
    const parsed = F1TelemetryClient.parseBufferMessage(buf);
    if (!parsed) continue;
    latest[parsed.packetID] = parsed.packetData.data;
    counts[parsed.packetID] = (counts[parsed.packetID] || 0) + 1;
  }
});

describe('F1 25 packets from a real session', () => {
  test('every packet type the dashboard uses is parsed', () => {
    for (const name of ['motion', 'session', 'lapData', 'event', 'participants', 'carSetups', 'carTelemetry', 'carStatus',
      'carDamage', 'sessionHistory', 'tyreSets', 'motionEx', 'lapPositions']) {
      assert.ok(counts[name] > 0, `${name} parsed`);
    }
  });

  test('header: 2025 format, packet ids, player car and 64-bit session id', () => {
    const h = latest.session.m_header;
    assert.equal(h.m_packetFormat, 2025);
    assert.equal(h.m_gameYear, 25);
    assert.equal(h.m_packetId, 1);
    assert.equal(h.m_playerCarIndex, 9);
    assert.equal(typeof h.m_sessionUID, 'bigint');
    assert.equal(String(h.m_sessionUID), '14889307717433790206');
    const header = F1TelemetryClient.parsePacketHeader(fixturePackets()[0].buf);
    assert.equal(header.m_packetFormat, 2025);
  });

  test('session: Catalunya, track length and race distance', () => {
    const s = latest.session;
    assert.equal(s.m_trackId, 4);
    assert.equal(constants.TRACKS[s.m_trackId].name, 'Catalunya');
    assert.equal(s.m_trackLength, 4664);
    assert.equal(s.m_totalLaps, 1);
    assert.equal(s.m_weather, 5);
    for (const f of ['m_pitStopWindowIdealLap', 'm_pitStopWindowLatestLap', 'm_pitStopRejoinPosition']) assert.ok(f in s, f);
  });

  test('participants: 32-byte F1 25 names, teams and race numbers', () => {
    const p = latest.participants;
    assert.equal(p.m_numActiveCars, 10);
    const cars = p.m_participants.slice(0, 10);
    assert.deepEqual(cars.map(c => c.m_name), [
      'PIASTRI', 'NORRIS', 'RUSSELL', 'ANTONELLI', 'VERSTAPPEN', 'HADJAR', 'LECLERC', 'HAMILTON', 'Ma3uR', 'Windman999',
    ]);
    assert.deepEqual(cars.map(c => c.m_raceNumber), [81, 4, 63, 12, 33, 6, 16, 44, 24, 21]);
    assert.deepEqual(cars.map(c => c.m_teamId), [228, 228, 220, 220, 222, 222, 221, 221, 223, 223]);
    assert.deepEqual(cars.map(c => c.m_aiControlled), [1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  test('lap data: unique positions and sane distances for every active car', () => {
    const active = latest.lapData.m_lapData.filter(l => l.m_resultStatus >= 2);
    assert.equal(active.length, 10);
    assert.deepEqual(active.map(l => l.m_carPosition).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const l of active) {
      assert.ok(Math.abs(l.m_lapDistance) <= 4664 + 50, `lap distance ${l.m_lapDistance}`);
      assert.ok('m_deltaToCarInFrontMSPart' in l && 'm_deltaToRaceLeaderMinutesPart' in l, 'F1 24+ split deltas');
    }
  });

  test('telemetry, status, damage and motion values are in range', () => {
    const tel = latest.carTelemetry.m_carTelemetryData.slice(0, 10);
    for (const t of tel) {
      assert.ok(t.m_speed >= 0 && t.m_speed < 400, `speed ${t.m_speed}`);
      assert.ok(t.m_gear >= -1 && t.m_gear <= 8, `gear ${t.m_gear}`);
      assert.ok(t.m_throttle >= 0 && t.m_throttle <= 1);
      assert.equal(t.m_tyresSurfaceTemperature.length, 4);
      assert.equal(t.m_brakesTemperature.length, 4);
    }
    const status = latest.carStatus.m_carStatusData.slice(0, 10);
    assert.ok(status.every(s => s.m_visualTyreCompound === 8), 'wet tyres in the storm');
    assert.ok(status.every(s => typeof s.m_fuelRemainingLaps === 'number'));
    const dmg = latest.carDamage.m_carDamageData;
    assert.deepEqual(dmg[6].m_tyresWear, [1, 1, 0, 0]);
    assert.deepEqual(dmg[6].m_tyreBlisters, [0, 0, 0, 0], 'F1 25 blister field keeps later cars aligned');
    assert.ok(dmg.slice(0, 10).every(d => d.m_tyresWear.every(w => w >= 0 && w <= 100)));
    const m = latest.motion.m_carMotionData[0];
    assert.ok(Number.isFinite(m.m_worldPositionX) && Number.isFinite(m.m_worldPositionZ));
  });

  test('event, history, tyre sets, setups, extended motion and lap positions', () => {
    assert.match(latest.event.m_eventStringCode, /^[A-Z]{4}$/);
    const h = latest.sessionHistory;
    assert.ok(h.m_carIdx >= 0 && h.m_carIdx < 22);
    assert.equal(h.m_lapHistoryData.length, 100);
    assert.equal(latest.tyreSets.m_tyreSetData.length, 20);
    assert.equal(latest.carSetups.m_carSetups.length, 22);
    assert.equal(latest.motionEx.m_wheelSpeed.length, 4);
    assert.equal(latest.lapPositions.m_positionForVehicleIdx[0].length, 22);
  });

  test('client emits parsed packets by name', () => {
    const client = new F1TelemetryClient({port: 0});
    const got = new Set();
    for (const name of Object.values(PACKETS)) client.on(name, () => got.add(name));
    for (const {buf} of fixturePackets()) client.handleMessage(buf);
    assert.ok(got.has('session') && got.has('lapData') && got.has('participants'));
    client.socket.close();
  });

  test('truncated packets throw rather than return garbage', () => {
    const session = fixturePackets().find(p => p.buf[6] === 1).buf;
    assert.throws(() => F1TelemetryClient.parseBufferMessage(session.subarray(0, 200)));
  });
});
