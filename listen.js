// Console-only listener: prints the player's session, telemetry and lap info as packets arrive.
const {F1TelemetryClient, constants} = require('./build/src');
const {PACKETS} = constants;

const formatSession = d => `session ${d.m_header.m_packetFormat} track ${d.m_trackId}`;
function formatTelemetry(d) {
  const c = d.m_carTelemetryData[d.m_header.m_playerCarIndex];
  return `speed=${c.m_speed} gear=${c.m_gear} rpm=${c.m_engineRPM} throttle=${c.m_throttle.toFixed(2)} brake=${c.m_brake.toFixed(2)}`;
}
function formatLap(d) {
  const l = d.m_lapData[d.m_header.m_playerCarIndex];
  return `lap=${l.m_currentLapNum} lastLap=${l.m_lastLapTimeInMS}ms`;
}

function createListener(port, print = console.log) {
  const client = new F1TelemetryClient({port});
  client.on(PACKETS.session, d => print(formatSession(d)));
  client.on(PACKETS.carTelemetry, d => print(formatTelemetry(d)));
  client.on(PACKETS.lapData, d => print(formatLap(d)));
  return client;
}

module.exports = {formatSession, formatTelemetry, formatLap, createListener};

if (require.main === module) {
  const port = Number(process.env.UDP_PORT) || 20777;
  const client = createListener(port);
  client.start();
  console.log(`Listening for F1 UDP telemetry on port ${port}...`);
  process.on('SIGINT', () => {
    client.stop();
    process.exit(0);
  });
}
