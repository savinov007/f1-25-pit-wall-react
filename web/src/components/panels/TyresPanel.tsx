// Your car's tyres (wear, temperatures, pressures), fuel, ERS and damage.
import {memo} from 'react';
import {useServer} from '../../store/dashboard';
import {CarDiagram} from '../car/CarDiagram';
import {DamageTiles} from '../car/DamageTiles';
import {Compound, Meters} from '../car/Meters';

export const TyresPanel = memo(function TyresPanel() {
  const {telemetry, damage, status, format} = useServer(s => ({
    telemetry: s?.telemetry,
    damage: s?.damage,
    status: s?.status,
    format: s?.session?.packetFormat,
  }));
  return (
    <>
      <h2>
        <span>Tyres &amp; car</span>
        <Compound status={status} />
      </h2>
      <div className="tyrebox">
        <CarDiagram telemetry={telemetry} damage={damage} />
      </div>
      <Meters status={status} format={format} />
      <DamageTiles damage={damage} />
    </>
  );
});
