// Your car: rev lights, gear / speed / RPM, pedals, steering and the pedal trace.
import {memo} from 'react';
import {useServer} from '../../store/dashboard';
import {buffers} from '../../telemetry/buffers';
import {Pedals, PedalTrace, SpeedRow} from '../car/DrivingReadout';

const REV_LEDS = 15; // 5 green, 5 red, 5 blue

function RevLights({percent}: {percent: number}) {
  const lit = Math.round((percent / 100) * REV_LEDS);
  return (
    <div className="rev">
      {Array.from({length: REV_LEDS}, (_, i) => (
        <i key={i} className={(i < 5 ? 'g' : i < 10 ? 'r' : 'b') + (i < lit ? ' on' : '')} />
      ))}
    </div>
  );
}

const pedalTrail = () => buffers.pedals;

export const DrivingPanel = memo(function DrivingPanel() {
  const {telemetry, telemetry2, status, sessionType} = useServer(s => ({
    telemetry: s?.telemetry,
    telemetry2: s?.telemetry2,
    status: s?.status,
    sessionType: s?.session?.sessionType,
  }));
  return (
    <>
      <h2>
        <span>Driving</span>
      </h2>
      <RevLights percent={telemetry?.m_revLightsPercent || 0} />
      <SpeedRow telemetry={telemetry} telemetry2={telemetry2} status={status} sessionType={sessionType} rowClass="speedrow" />
      <Pedals telemetry={telemetry} />
      <PedalTrace trail={pedalTrail} />
    </>
  );
});
