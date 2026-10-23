import {F1Parser} from '../F1Parser';
import {numCars} from './numCars';
import {PacketHeaderParser} from './PacketHeaderParser';
import {PacketCarTelemetry2Data} from './types';

// Packet 16 (UDP format 2026): active aero, overtake mode and 2026-regulation flags for every car.
export class CarTelemetry2DataParser extends F1Parser {
  constructor() {
    super();
    this.uint8('m_activeAeroMode')
      .uint8('m_activeAeroAvailable')
      .uint16le('m_activeAeroActivationDistance')
      .uint8('m_overtakeAvailable')
      .uint8('m_overtakeActive')
      .uint16le('m_overtakeActivationDistance')
      .uint8('m_2026Regulations')
      .uint8('m_drivingWrongWay');
  }
}

export class PacketCarTelemetry2DataParser extends F1Parser {
  data: PacketCarTelemetry2Data;

  constructor(buffer: Buffer, packetFormat: number) {
    super();
    this.endianess('little')
      .nest('m_header', {type: new PacketHeaderParser(packetFormat)})
      .array('m_carTelemetry2Data', {length: numCars(packetFormat), type: new CarTelemetry2DataParser()});
    this.data = this.fromBuffer(buffer);
  }
}
