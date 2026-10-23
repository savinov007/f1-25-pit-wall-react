const { F1TelemetryClient, constants } = require('./build/src');
const { PACKETS } = constants;

const client = new F1TelemetryClient({ port: 20777 });

client.on(PACKETS.session, d => console.log('session', d.m_header.m_packetFormat, 'track', d.m_trackId));
client.on(PACKETS.carTelemetry, d => {
  const idx = d.m_header.m_playerCarIndex;
  const c = d.m_carTelemetryData[idx];
  console.log(`speed=${c.m_speed} gear=${c.m_gear} rpm=${c.m_engineRPM} throttle=${c.m_throttle.toFixed(2)} brake=${c.m_brake.toFixed(2)}`);
});
client.on(PACKETS.lapData, d => {
  const l = d.m_lapData[d.m_header.m_playerCarIndex];
  console.log(`lap=${l.m_currentLapNum} lastLap=${l.m_lastLapTimeInMS}ms`);
});

client.start();
console.log('Listening for F1 UDP telemetry on port 20777...');
process.on('SIGINT', () => { client.stop(); process.exit(0); });
