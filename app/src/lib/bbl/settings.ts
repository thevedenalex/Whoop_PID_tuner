// Извлечение фактических настроек PID/фильтров из H-заголовков blackbox-лога.
// Betaflight пишет их при начале записи (rollPID/pitchPID/yawPID, фильтры, TPA, FF и т.д.),
// поэтому по логу можно восстановить конфигурацию, на которой он был записан.
import type { BblHeaders } from './types'

export interface AxisPidVals {
  p: number
  i: number
  d: number
}

export interface LogSettings {
  hasPid: boolean
  pid: { roll: AxisPidVals; pitch: AxisPidVals; yaw: AxisPidVals }
  filters: { [key: string]: number }
  other: { [key: string]: number }
}

function parseNums(v: string | undefined): number[] {
  if (!v) return []
  return v
    .split(',')
    .map((x) => parseFloat(x.trim()))
    .filter((x) => !isNaN(x))
}

function num(v: string | undefined, dflt = 0): number {
  const x = parseFloat(v ?? '')
  return isNaN(x) ? dflt : x
}

export function extractLogSettings(h: BblHeaders): LogSettings | null {
  if (!h || typeof h !== 'object') return null
  const r = parseNums(h['rollPID'])
  const p = parseNums(h['pitchPID'])
  const y = parseNums(h['yawPID'])
  const hasPid = r.length >= 3 && p.length >= 3 && y.length >= 3
  const d1 = parseNums(h['dterm_lpf1_dyn_hz'])
  const g1 = parseNums(h['gyro_lpf1_dyn_hz'])
  const filters: { [key: string]: number } = {
    gyro_lpf1_static_hz: num(h['gyro_lpf1_static_hz']),
    gyro_lpf1_type: num(h['gyro_lpf1_type']),
    gyro_lpf1_dyn_min_hz: g1[0] ?? 0,
    gyro_lpf1_dyn_max_hz: g1[1] ?? 0,
    gyro_lpf2_static_hz: num(h['gyro_lpf2_static_hz']),
    gyro_lpf2_type: num(h['gyro_lpf2_type'], 1),
    dyn_notch_count: num(h['dyn_notch_count']),
    dyn_notch_q: num(h['dyn_notch_q'], 450),
    dyn_notch_min_hz: num(h['dyn_notch_min_hz']),
    dyn_notch_max_hz: num(h['dyn_notch_max_hz'], 400),
    dterm_lpf1_static_hz: num(h['dterm_lpf1_static_hz']),
    dterm_lpf1_dyn_min_hz: d1[0] ?? 0,
    dterm_lpf1_dyn_max_hz: d1[1] ?? 0,
    dterm_lpf1_type: num(h['dterm_lpf1_type'], 1),
    dterm_lpf2_static_hz: num(h['dterm_lpf2_static_hz']),
    dterm_lpf2_type: num(h['dterm_lpf2_type'], 1),
    yaw_lowpass_hz: num(h['yaw_lowpass_hz']),
  }
  const other: { [key: string]: number } = {
    tpa_rate: num(h['tpa_rate']),
    tpa_breakpoint: num(h['tpa_breakpoint'], 1650),
    iterm_relax_cutoff: num(h['iterm_relax_cutoff'], 10),
    antigravity_gain: num(h['anti_gravity_gain'], 80),
    feedforward_boost: num(h['feedforward_boost']),
    motor_output_limit: num(h['motor_output_limit'], 100),
  }
  return {
    hasPid,
    pid: {
      roll: { p: r[0] ?? 0, i: r[1] ?? 0, d: r[2] ?? 0 },
      pitch: { p: p[0] ?? 0, i: p[1] ?? 0, d: p[2] ?? 0 },
      yaw: { p: y[0] ?? 0, i: y[1] ?? 0, d: y[2] ?? 0 },
    },
    filters,
    other,
  }
}
