// UDP format 2026 (F1 25: 2026 Season Pack, spec v1.2), using packets built byte by byte from the spec.
const {test, describe} = require('node:test');
const assert = require('node:assert/strict');
const {F1TelemetryClient, constants} = require('../build/src');
const {build, SPEC_SIZES, TEAM_IDS, NAMES, CARS} = require('./f1-2026');

const parse = name => F1TelemetryClient.parseBufferMessage(build(name));
const data = name => parse(name).packetData.data;
const near = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

describe('UDP format 2026', () => {
  test('every packet type parses at the size the spec gives', () => {
    for (const [name, size] of Object.entries(SPEC_SIZES)) {
      assert.equal(build(name).length, size, `${name} built at spec size`);
      assert.equal(constants.PACKET_SIZES[name][2026], size, `${name} size constant`);
      assert.equal(parse(name).packetID, name);
    }
  });

  test('header: format 2026, 64-bit session id', () => {
    const h = data('session').m_header;
    assert.equal(h.m_packetFormat, 2026);
    assert.equal(h.m_gameYear, 25, 'the season pack still reports game year 25');
    assert.equal(h.m_overallFrameIdentifier, 1001);
    assert.equal(h.m_secondaryPlayerCarIndex, 255);
  });

  test('24 cars in every per-car array', () => {
    assert.equal(data('motion').m_carMotionData.length, CARS);
    assert.equal(data('lapData').m_lapData.length, CARS);
    assert.equal(data('participants').m_participants.length, CARS);
    assert.equal(data('carSetups').m_carSetups.length, CARS);
    assert.equal(data('carTelemetry').m_carTelemetryData.length, CARS);
    assert.equal(data('carStatus').m_carStatusData.length, CARS);
    assert.equal(data('finalClassification').m_classificationData.length, CARS);
    assert.equal(data('lobbyInfo').m_lobbyPlayers.length, CARS);
    assert.equal(data('carDamage').m_carDamageData.length, CARS);
    assert.equal(data('lapPositions').m_positionForVehicleIdx[0].length, CARS);
    assert.equal(data('carTelemetry2').m_carTelemetry2Data.length, CARS);
    // the last car's data lands in the right place
    assert.equal(data('lapData').m_lapData[23].m_carPosition, 24);
    assert.equal(data('carTelemetry').m_carTelemetryData[23].m_speed, 273);
    assert.deepEqual(data('carDamage').m_carDamageData[23].m_tyresWear, [33, 34, 35, 36]);
  });

  test('participants: uint16 driver, network and team ids', () => {
    const p = data('participants').m_participants;
    assert.deepEqual(p.map(c => c.m_teamId), TEAM_IDS);
    assert.deepEqual(p.map(c => c.m_name), NAMES);
    assert.equal(p[0].m_driverId, 65535, 'network human');
    assert.equal(p[5].m_driverId, 305);
    assert.equal(p[3].m_raceNumber, 4);
    assert.equal(constants.TEAMS[2026][485].name, 'Audi');
    assert.equal(constants.TEAMS[2026][486].name, 'Cadillac');
    assert.equal(constants.TEAMS[2026][476].name, 'Mercedes');
  });

  test('motion: quantised g-forces come back in G', () => {
    const m = data('motion').m_carMotionData;
    assert.ok(near(m[0].m_gForceLateral, 1.234));
    assert.ok(near(m[0].m_gForceLongitudinal, -2.5));
    assert.ok(near(m[0].m_gForceVertical, 1));
    assert.ok(near(m[7].m_worldPositionX, 107));
    assert.ok(near(m[0].m_roll, 0.3));
  });

  test('telemetry: uint8 engine temperature, fields after it still aligned', () => {
    const t = data('carTelemetry');
    const c = t.m_carTelemetryData[5];
    assert.equal(c.m_engineTemperature, 112);
    assert.deepEqual(c.m_tyresPressure, [23, 23.5, 24, 24.5]);
    assert.deepEqual(c.m_tyresInnerTemperature, [100, 101, 102, 103]);
    assert.equal(c.m_gear, 7);
    assert.equal(t.m_suggestedGear, 0);
  });

  test('status: ERS harvest limit per lap', () => {
    const s = data('carStatus').m_carStatusData[0];
    assert.equal(s.m_ersHarvestedLimitPerLap, 8500000);
    assert.equal(s.m_ersDeployedThisLap, 2000000);
    assert.equal(s.m_ersDeployMode, 3, 'boost');
    assert.equal(s.m_networkPaused, 0);
  });

  test('session: Madrid, active aero and DRS zones, reaction time, new assists', () => {
    const s = data('session');
    assert.equal(s.m_trackId, 42);
    assert.equal(constants.TRACKS[42].name, 'Madrid');
    assert.equal(s.m_trackLength, 5476);
    assert.equal(s.m_pitStopWindowIdealLap, 20);
    assert.equal(s.m_activeAeroTrackStatus, 0);
    assert.equal(s.m_numActiveAeroZonesFull, 2);
    assert.ok(near(s.m_activeAeroZonesFull[1].m_zoneStart, 0.6));
    assert.equal(s.m_numActiveAeroZonesPartial, 1);
    assert.equal(s.m_numDRSZones, 1);
    assert.ok(near(s.m_drsZones[0].m_zoneEnd, 0.95));
    assert.ok(near(s.m_startReactionTime, 0.214));
    assert.deepEqual([s.m_antiLockBrakesAssist, s.m_tractionControlAssist, s.m_dynamicRacingLineHiVis,
      s.m_dynamicRacingLineColourBlind, s.m_recurringRewindPrompt], [1, 2, 1, 3, 1]);
  });

  test('car telemetry 2 (packet 16): active aero, overtake, regulations, wrong way', () => {
    const d = data('carTelemetry2').m_carTelemetry2Data;
    assert.deepEqual(d[0], {
      m_activeAeroMode: 0, m_activeAeroAvailable: 1, m_activeAeroActivationDistance: 150, m_overtakeAvailable: 1,
      m_overtakeActive: 1, m_overtakeActivationDistance: 0, m_2026Regulations: 1, m_drivingWrongWay: 0,
    });
    assert.equal(d[1].m_activeAeroMode, 1);
    assert.equal(d[1].m_overtakeActivationDistance, 400);
    assert.equal(d[23].m_drivingWrongWay, 1);
    assert.equal(constants.PACKETS.carTelemetry2, 'carTelemetry2');
  });

  test('lobby, time trial, final classification, setups and lap positions', () => {
    assert.equal(data('lobbyInfo').m_lobbyPlayers[20].m_teamId, 486);
    assert.equal(data('lobbyInfo').m_lobbyPlayers[20].m_readyStatus, 1);
    assert.equal(data('timeTrial').m_rivalDataSet.m_teamId, 485);
    assert.equal(data('timeTrial').m_rivalDataSet.m_valid, 1);
    const fc = data('finalClassification');
    assert.equal(fc.m_numCars, 24);
    assert.equal(fc.m_classificationData[23].m_bestLapTimeInMS, 88023);
    assert.equal(data('carSetups').m_nextFrontWingValue, 21);
    assert.deepEqual(data('lapPositions').m_positionForVehicleIdx[1].slice(0, 3), [1, 2, 3]);
  });

  test('events: collision severity, and new race-control codes', () => {
    assert.deepEqual(data('event').m_eventDetails, {vehicle1Idx: 3, vehicle2Idx: 5, severity: 2});
    const ev = code => {
      const b = build('event');
      b.write(code, 29, 'utf8');
      return F1TelemetryClient.parseBufferMessage(b).packetData.data;
    };
    assert.deepEqual(ev('PMEN').m_eventDetails, {reason: 3});
    assert.equal(ev('OVEN').m_eventStringCode, 'OVEN');
    assert.equal(ev('FTLP').m_eventDetails.vehicleIdx, 3, 'older codes keep their 2025 layout');
    for (const code of ['PMEN', 'PMDI', 'OVEN', 'OVDI']) assert.ok(Object.values(constants.EVENT_CODES).includes(code));
  });

  test('2025 packets still parse as before', () => {
    const {fixturePackets} = require('./helpers');
    const session = fixturePackets().find(p => p.buf[6] === 1).buf;
    const s = F1TelemetryClient.parseBufferMessage(session).packetData.data;
    assert.equal(s.m_trackLength, 4664);
    assert.equal(s.m_numDRSZones, undefined);
  });
});
