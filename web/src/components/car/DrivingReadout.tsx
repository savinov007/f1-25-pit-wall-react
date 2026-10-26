// Gear, speed and RPM with the DRS / battery / aero badges, the pedal bars and steering, and the pedal trace.
// The same readout serves the driving panel (your car) and the rival popup.
import type {CarStatus, Telemetry, Telemetry2} from '@shared';
import {drawPedalTrace} from '../../charts/pedalTrace';
import {useCanvasFrame} from '../../hooks/useCanvasFrame';
import {getServerState} from '../../store/dashboard';
import {buffers, type PedalSample} from '../../telemetry/buffers';
import {Badges, gearText} from './Badges';

interface Props {
  telemetry: Telemetry | null | undefined;
  telemetry2: Telemetry2 | null | undefined;
  status: CarStatus | null | undefined;
  sessionType: number | undefined;
  /** 'speedrow' on the dashboard, 'dmspeed' in the popup (sized differently). */
  rowClass: string;
}

export function SpeedRow({telemetry: t, telemetry2, status, sessionType, rowClass}: Props) {
  return (
    <div className={rowClass}>
      <div className="gear">
        <div className="lbl">GEAR</div>
        <div className="gearv">{t ? gearText(t.m_gear) : 'N'}</div>
      </div>
      <div className="speed">
        <div className="speedv">{t ? t.m_speed : 0}</div>
        <div className="lbl">KM/H</div>
      </div>
      <div className="rpm">
        <div className="lbl">RPM</div>
        <div className="rpmv">{t ? t.m_engineRPM : 0}</div>
        <Badges telemetry={t} telemetry2={telemetry2} status={status} sessionType={sessionType} />
      </div>
    </div>
  );
}

export function Pedals({telemetry: t}: {telemetry: Telemetry | null | undefined}) {
  return (
    <div className="pedals">
      <div className="pedal">
        <div className="bar">
          <i className="thr" style={{height: (t ? t.m_throttle * 100 : 0) + '%'}} />
        </div>
        <span>THR</span>
      </div>
      <div className="pedal">
        <div className="bar">
          <i className="brk" style={{height: (t ? t.m_brake * 100 : 0) + '%'}} />
        </div>
        <span>BRK</span>
      </div>
      <div className="steer">
        <div className="steerbar">
          <i className="steerv" style={{left: 50 + (t ? t.m_steer : 0) * 45 + '%'}} />
        </div>
        <span>STEER</span>
      </div>
    </div>
  );
}

/** The rolling 10 s throttle / brake trace with the corners marked; `trail` is read on every frame, so pass a getter. */
export function PedalTrace({trail}: {trail: () => PedalSample[]}) {
  const ref = useCanvasFrame((ctx, w, h, now) =>
    drawPedalTrace(ctx, w, h, trail(), now, {corners: buffers.corners, trackLength: getServerState()?.session?.trackLength})
  );
  return <canvas ref={ref} className="trace" />;
}
