import {numCars} from './numCars';
import {F1Parser} from '../F1Parser';
import {FinalClassificationDataParser} from './FinalClassificationDataParser';
import {PacketHeaderParser} from './PacketHeaderParser';
import {PacketFinalClassificationData} from './types';

export class PacketFinalClassificationDataParser extends F1Parser {
  data: PacketFinalClassificationData;

  constructor(buffer: Buffer, packetFormat: number) {
    super();

    this.endianess('little')
      .nest('m_header', {
        type: new PacketHeaderParser(packetFormat),
      })
      .uint8('m_numCars')
      .array('m_classificationData', {
        length: numCars(packetFormat),
        type: new FinalClassificationDataParser(packetFormat),
      });

    this.data = this.fromBuffer(buffer);
  }
}
