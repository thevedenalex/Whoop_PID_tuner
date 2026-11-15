// Types for Betaflight Blackbox (.bbl) parsing and analysis

export interface BblHeaders {
  [key: string]: string
}

export interface ParsedLog {
  headers: BblHeaders
  /** Canonical field names as stored, e.g. "axisP[0]", "gyroADC[2]", "motor[3]" */
  fieldNames: string[]
  frameCount: number
  truncated: boolean
  stopReason: string
  /** Decoded data for the fields we care about */
  data: FieldData
  loopHz: number
  durationMs: number
  motorCount: number
  gyroRes: number
  logIndex: number
  logCount: number
}

export type NumArr = Float32Array | Float64Array
export type FieldData = { [field: string]: NumArr }

export const AXIS = ['roll', 'pitch', 'yaw'] as const
export type AxisName = (typeof AXIS)[number]

/** Fields stored verbatim (scalar, no [n] suffix) */
const STORED_SCALAR = ['loopIteration', 'time', 'vbatLatest', 'amperageLatest', 'rssi']

export function isStoredField(name: string): boolean {
  if (STORED_SCALAR.indexOf(name) !== -1) return true
  return /^(axis[PIDF]|gyroADC|gyroUnfilt|accSmooth|debug|rcCommand|setpoint|motor|eRPM)\[\d+\]$/.test(
    name
  )
}
