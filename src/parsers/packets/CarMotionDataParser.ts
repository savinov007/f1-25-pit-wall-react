import {F1Parser} from '../F1Parser';

export class CarMotionDataParser extends F1Parser {
  constructor(packetFormat = 2025) {
    super();
    this.floatle('m_worldPositionX')
      .floatle('m_worldPositionY')
      .floatle('m_worldPositionZ')
      .floatle('m_worldVelocityX')
      .floatle('m_worldVelocityY')
      .floatle('m_worldVelocityZ')
      .int16le('m_worldForwardDirX')
      .int16le('m_worldForwardDirY')
      .int16le('m_worldForwardDirZ')
      .int16le('m_worldRightDirX')
      .int16le('m_worldRightDirY')
      .int16le('m_worldRightDirZ');
    if (packetFormat >= 2026) {
      // quantised: int16 thousandths of a G, scaled back to G
      const g = {formatter: (v: number) => v / 1000};
      this.int16le('m_gForceLateral', g).int16le('m_gForceLongitudinal', g).int16le('m_gForceVertical', g);
    } else {
      this.floatle('m_gForceLateral').floatle('m_gForceLongitudinal').floatle('m_gForceVertical');
    }
    this.floatle('m_yaw')
      .floatle('m_pitch')
      .floatle('m_roll');
  }
}
