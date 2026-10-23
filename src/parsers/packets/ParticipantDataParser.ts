import {F1Parser} from '../F1Parser';
import {LiveryColourParser} from './LiveryColourParser';

export class ParticipantDataParser extends F1Parser {
  constructor(packetFormat: number) {
    super();

    this.uint8('m_aiControlled');

    // 2026 widened driver, network and team ids to uint16 (2026 team ids are 476+)
    if (packetFormat >= 2026) {
      this.uint16le('m_driverId').uint16le('m_networkId').uint16le('m_teamId');
    } else {
      this.uint8('m_driverId').uint8('m_networkId').uint8('m_teamId');
    }

    this.uint8('m_myTeam').uint8('m_raceNumber').uint8('m_nationality');

    // Name length: 32 from 2025, 48 in 2024 and earlier
    this.string('m_name', {
      length: packetFormat >= 2025 ? 32 : 48,
      stripNull: true,
    });

    this.uint8('m_yourTelemetry');

    if (packetFormat === 2023) {
      this.uint8('m_showOnlineNames').uint8('m_platform');
    }

    if (packetFormat === 2024) {
      this.uint8('m_showOnlineNames').uint16le('m_techLevel').uint8('m_platform');
    }

    if (packetFormat >= 2025) {
      this.uint8('m_showOnlineNames')
        .uint16le('m_techLevel')
        .uint8('m_platform')
        .uint8('m_numColours')
        .array('m_liveryColour', {length: 4, type: new LiveryColourParser()});
    }
  }
}
