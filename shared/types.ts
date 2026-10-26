// The messages the dashboard server pushes over the WebSocket (server.js), as the page reads them.
// Packet fields keep the game's names (m_...); only the fields the dashboard uses are listed.

export interface Telemetry {
  m_speed: number;
  m_gear: number;
  m_engineRPM: number;
  m_throttle: number;
  m_brake: number;
  m_steer: number;
  m_drs: number;
  m_revLightsPercent?: number;
  m_tyresSurfaceTemperature: number[];
  m_tyresInnerTemperature: number[];
  m_tyresPressure: number[];
  m_brakesTemperature?: number[];
}

/** UDP format 2026 only: active aero, overtake mode, wrong way. */
export interface Telemetry2 {
  m_activeAeroMode: number;
  m_activeAeroAvailable: number;
  m_activeAeroActivationDistance: number;
  m_overtakeAvailable: number;
  m_overtakeActive: number;
  m_overtakeActivationDistance: number;
  m_2026Regulations: number;
  m_drivingWrongWay: number;
}

export interface LapData {
  m_lastLapTimeInMS: number;
  m_currentLapTimeInMS: number;
  m_sector1TimeInMS?: number;
  m_sector2TimeInMS?: number;
  m_sector1TimeMSPart?: number;
  m_sector2TimeMSPart?: number;
  m_sector: number;
  m_carPosition: number;
  m_currentLapNum: number;
  m_pitStatus: number;
  m_currentLapInvalid: number;
  m_lapDistance: number;
}

export interface CarStatus {
  m_fuelInTank: number;
  m_fuelCapacity: number;
  m_fuelRemainingLaps?: number | null;
  m_visualTyreCompound: number;
  m_tyresAgeLaps: number;
  m_ersStoreEnergy: number;
  m_ersDeployMode: number;
  m_ersHarvestedLimitPerLap?: number;
}

export interface CarDamage {
  m_tyresWear?: number[];
  m_frontLeftWingDamage?: number;
  m_frontRightWingDamage?: number;
  m_rearWingDamage?: number;
  m_floorDamage?: number;
  m_diffuserDamage?: number;
  m_sidepodDamage?: number;
  m_gearBoxDamage?: number;
  m_engineDamage?: number;
}

export interface Motion {
  x: number;
  z: number;
  gLat: number;
  gLong: number;
}

/** [start, end] as fractions of the lap. */
export type Zone = [number, number];

export interface Session {
  track: string;
  trackId: number;
  totalLaps: number;
  trackLength: number;
  pitIdealLap: number;
  pitLatestLap: number;
  pitRejoinPos: number;
  weather: number;
  trackTemp: number;
  airTemp: number;
  sessionType: number;
  timeLeft: number;
  duration: number;
  sessionUID: string;
  packetFormat: number;
  aeroStatus?: number;
  aeroZones?: Zone[];
  drsZones?: Zone[];
  reactionTime?: number;
}

export interface PaceSummary {
  avgMs: number;
  trendMs: number | null;
  laps: {lap: number; ms: number}[];
}

/** Strategy measured by the server for one car (strategy.js). */
export interface CarStrategy {
  wear?: number[] | null;
  wearRate?: (number | null)[] | null;
  stintLaps?: number;
  pace?: PaceSummary | null;
  gapTrend?: {aheadIdx: number; rateMs: number} | null;
}

export interface Rival {
  idx: number;
  pos: number;
  name: string;
  num: number;
  teamId?: number;
  human?: boolean;
  telemetryPublic?: boolean;
  team: string;
  color: string;
  dist?: number;
  x?: number;
  z?: number;
  lapNum: number;
  last: number;
  best: number;
  gapFront: number;
  gapLeader: number;
  pit: number;
  driverStatus?: number;
  stops: number;
  penalty: number;
  result: number;
  compound: number;
  age: number;
  player: boolean;
  overtake?: number;
  wrongWay?: number;
  strategy?: CarStrategy | null;
}

/** A server history snapshot in its packed wire form (see historySnapshot). */
export interface HistorySnapshot {
  trail: number[];
  lt: (Omit<LapTraces<number[]>, 'best'> & {best: number[] | 'last'}) | null;
}

/** Data for one car the page asked for: the rival popup ('detail') or a compare column. */
export interface CarDetail {
  idx: number;
  telemetry: Telemetry | null;
  telemetry2?: Telemetry2 | null;
  status: CarStatus | null;
  damage: CarDamage | null;
  lap: LapData | null;
  motion?: {gLat: number; gLong: number} | null;
  history?: HistorySnapshot;
}

export interface Recording {
  available: boolean;
  active: boolean;
  seconds?: number;
  packets?: number;
  bytes?: number;
  lastFile?: string | null;
  lastBytes?: number;
  lastPackets?: number;
}

export interface ReplayStatus {
  file: string;
  playing: boolean;
  finished: boolean;
  speed: number;
  loop: boolean;
  pos: number;
  duration: number;
  packets?: number;
}

/** A numbered corner at a lap distance in metres. */
export interface Corner {
  n: string;
  d: number;
}

/** Whether the server has a map for this session's track (fetched from /api/track). */
export interface TrackMapInfo {
  trackId: number;
  trackLength: number;
  available: boolean;
}

export interface DashboardState {
  connected: boolean;
  hasData: boolean;
  pps: number;
  setup?: {ips: {name: string; address: string}[]; udpPort: number; demo?: boolean} | null;
  replay?: ReplayStatus | null;
  recording?: Recording | null;
  session?: Session | null;
  telemetry?: Telemetry | null;
  telemetry2?: Telemetry2 | null;
  lap?: LapData | null;
  status?: CarStatus | null;
  damage?: CarDamage | null;
  motion?: Motion | null;
  rivals?: Rival[];
  pitLoss?: {ms: number; samples: number} | null;
  trackMap?: TrackMapInfo | null;
  detail?: CarDetail;
  compare?: CarDetail[];
}

/** One chart sample: pedals, gear, battery charge (0..1), ERS deploy mode and lap distance; null = not known yet. */
export interface TraceSample {
  speed: number;
  thr: number;
  brk: number;
  gear: number;
  ers: number | null;
  mode: number | null;
  /** Metres round the lap (marks the corners on time charts). */
  ld: number | null;
}
export type TimePoint = TraceSample & {t: number};
export type DistPoint = TraceSample & {d: number};

/** Per car: lap-distance traces of the current, last and best lap. */
export interface LapTraces<P = DistPoint[]> {
  lap: number;
  cur: P;
  last: P;
  lastLap: number | null;
  best: P;
  bestLap: number | null;
  bestTime: number;
  invalid: boolean;
}

/** One recording in the saved replays list (GET /api/replays). */
export interface RecordingInfo {
  file: string;
  bytes: number;
  modified: number;
  startedAt: string | null;
  duration: number | null;
}
