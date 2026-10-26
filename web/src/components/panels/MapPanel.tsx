// Track map (canvas, drawn every frame) with the 2026 zone legend and your g-forces.
import {memo} from 'react';
import {drawTrackMap} from '../../charts/trackMap';
import {useCanvasFrame} from '../../hooks/useCanvasFrame';
import {getServerState, useServer} from '../../store/dashboard';
import {buffers} from '../../telemetry/buffers';

export const MapPanel = memo(function MapPanel() {
  const {zones, gLat, gLong} = useServer(s => ({
    zones: !!(s?.session?.aeroZones?.length || s?.session?.drsZones?.length),
    gLat: s?.motion?.gLat,
    gLong: s?.motion?.gLong,
  }));
  const ref = useCanvasFrame((ctx, w, h) => {
    const s = getServerState();
    drawTrackMap(ctx, w, h, {track: buffers.track, rivals: s?.rivals || [], car: buffers.car, session: s?.session, corners: buffers.corners});
  });
  return (
    <>
      <h2>
        <span>Track map</span>
        {zones && (
          <span className="maplegend">
            <i className="lz aero" />
            ACTIVE AERO
            <i className="lz drsz" />
            DRS
          </span>
        )}
      </h2>
      <canvas ref={ref} className="mapcv" />
      <div className="g">
        <span>
          G-LAT <b>{(gLat ?? 0).toFixed(1)}</b>
        </span>
        <span>
          G-LONG <b>{(gLong ?? 0).toFixed(1)}</b>
        </span>
      </div>
    </>
  );
});
