// Cars per packet array: F1 25's 2026 season pack (UDP format 2026) raised the limit from 22 to 24.
export const numCars = (packetFormat: number): number => (packetFormat >= 2026 ? 24 : 22);
