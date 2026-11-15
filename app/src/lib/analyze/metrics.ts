// Flight-metrics extraction from a decoded Blackbox log:
//  - step response per axis (overshoot, rise time, settle time, delay)
//  - gyro noise RMS at hover vs full throttle
//  - motor saturation time
//  - I-term load at hover

import type { NumArr, ParsedLog } from '../bbl/types'
import { getVec, getField } from '../bbl/parser'

export interface AxisMetrics {
  events: number
  overshootPct: number | null
  riseMs: number | null
  settleMs: number | null
  delayMs: number | null
}

export interface StepEvent {
  axis: number
  t0Ms: number
  target: number
  /** downsampled traces relative to t0Ms: setpoint, gyro */
  trace: { t: number; sp: number; gyro: number }[]
}

export interface ExcludedSegment {
  fromMs: number
  toMs: number
  kind: 'ground' | 'crash'
}

export interface FlightInfo {
  /** доля фреймов чистого полёта, % */
  flightPct: number
  /** доля исключённого «земного» времени (стол, посадка, дизарм), % */
  groundPct: number
  /** доля исключённых пинов моторов (столкновение/застревание), % */
  crashPinPct: number
  /** число фреймов, попавших в анализ */
  frames: number
}

export interface LogMetrics {
  axes: AxisMetrics[]
  noiseHoverDps: number | null
  noiseFullDps: number | null
  noiseRatio: number | null
  motorSatPct: number | null
  itermHover: (number | null)[]
  itermLimit: number
  latencyMs: number | null
  throttleMeanPct: number | null
  steps: StepEvent[]
  hasGyro: boolean
  hasSetpoint: boolean
  hasMotors: boolean
  notes: string[]
  flight: FlightInfo
  excluded: ExcludedSegment[]
}

const EMPTY_AXIS: AxisMetrics = {
  events: 0,
  overshootPct: null,
  riseMs: null,
  settleMs: null,
  delayMs: null,
}

function movingAverage(src: NumArr, win: number): Float32Array {
  const out = new Float32Array(src.length)
  let sum = 0
  const half = Math.floor(win / 2)
  for (let i = 0; i < src.length; i++) {
    sum += src[i]
    if (i >= win) sum -= src[i - win]
    out[i] = sum / Math.min(i + 1, win)
  }
  // fix edges approximately (causal window) — good enough for detrending
  void half
  return out
}

function rms(v: number[]): number {
  if (!v.length) return 0
  let s = 0
  for (const x of v) s += x * x
  return Math.sqrt(s / v.length)
}

export function analyzeLog(log: ParsedLog): LogMetrics {
  const notes: string[] = []
  const gyro = getVec(log, 'gyroADC', 3)
  let sp = getVec(log, 'setpoint', 3)
  let hasSetpoint = sp.every((x) => x !== null)
  if (!hasSetpoint) {
    sp = getVec(log, 'rcCommand', 3)
    hasSetpoint = sp.every((x) => x !== null)
    if (hasSetpoint) notes.push('Поле setpoint отсутствует — использован rcCommand (старая прошивка, точность ниже)')
  }
  const hasGyro = gyro.every((x) => x !== null)
  const motors = getVec(log, 'motor', log.motorCount || 4)
  const hasMotors = motors.length > 0 && motors.every((x) => x !== null) && log.motorCount > 0
  const throttleRaw = getField(log, 'setpoint[3]') || getField(log, 'rcCommand[3]')
  const axisI = getVec(log, 'axisI', 3)
  const time = getField(log, 'time')
  const n = time ? time.length : 0

  const metrics: LogMetrics = {
    axes: [0, 1, 2].map(() => ({ ...EMPTY_AXIS })),
    noiseHoverDps: null,
    noiseFullDps: null,
    noiseRatio: null,
    motorSatPct: null,
    itermHover: [null, null, null],
    itermLimit: 500,
    latencyMs: null,
    throttleMeanPct: null,
    steps: [],
    hasGyro,
    hasSetpoint,
    hasMotors,
    notes,
    flight: { flightPct: 100, groundPct: 0, crashPinPct: 0, frames: 0 },
    excluded: [],
  }

  if (!time || n < 100) {
    notes.push('Слишком мало фреймов для анализа')
    return metrics
  }
  const hz = log.loopHz || 1000
  const dtMs = 1000 / hz
  const t0 = time[0]
  const ms = (i: number) => (time[i] - t0) / 1000

  // ---------- маска «чистого полёта» ----------
  // Исключаем нештатные участки: стоянку на столе/земле (газ на минимуме, гироскоп тихий),
  // посадку/дизарм, а также пин всех моторов в упор без ввода стиков (столкновение, застревание).
  const mask = new Uint8Array(n).fill(1)
  const crashMark = new Uint8Array(n)
  let hasFlightSignal = false
  {
    // нормированный газ, %: setpoint[3] — миксерный газ 0..1000, rcCommand[3] — мкс 1000..2000
    let thrKnown = false
    const thrPct = new Float32Array(n)
    if (throttleRaw) {
      let mn = Infinity
      let mx = -Infinity
      for (let i = 0; i < n; i++) {
        const v = throttleRaw[i]
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      const isMixerScale = mx <= 1100 && mn >= 0
      thrKnown = true
      for (let i = 0; i < n; i++) {
        thrPct[i] = isMixerScale ? throttleRaw[i] / 10 : (throttleRaw[i] - 1000) / 10
      }
    }
    // модуль угловой скорости по гироскопу
    const gyroMag = hasGyro ? new Float32Array(n) : null
    if (gyroMag) {
      for (let i = 0; i < n; i++) {
        let m = 0
        for (let a = 0; a < 3; a++) {
          const v = Math.abs((gyro[a] as NumArr)[i])
          if (v > m) m = v
        }
        gyroMag[i] = m
      }
    }
    if (thrKnown || gyroMag) {
      hasFlightSignal = true
      for (let i = 0; i < n; i++) {
        const flying =
          (thrKnown && thrPct[i] > 3) || (gyroMag !== null && gyroMag[i] > 25)
        mask[i] = flying ? 1 : 0
      }
    }
    // пины моторов: все моторы у упора без движения стиков дольше ~1.2 с
    if (hasMotors && hasSetpoint) {
      const stickMag = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let m = 0
        for (let a = 0; a < 3; a++) {
          const v = Math.abs((sp[a] as NumArr)[i])
          if (v > m) m = v
        }
        stickMag[i] = m
      }
      const mm = motors as NumArr[]
      let motorMax = -Infinity
      for (const arr of mm) for (let i = 0; i < n; i++) if (arr[i] > motorMax) motorMax = arr[i]
      const pinLimit = motorMax > 1500 ? 1900 : 950
      const minRun = Math.round(1200 / dtMs)
      const pad = Math.round(300 / dtMs)
      let runStart = -1
      for (let i = 0; i <= n; i++) {
        let minM = Infinity
        if (i < n) for (const arr of mm) if (arr[i] < minM) minM = arr[i]
        const pinned = i < n && minM >= pinLimit && stickMag[i] < 60
        if (pinned && runStart < 0) runStart = i
        if ((!pinned || i === n) && runStart >= 0) {
          const runEnd = pinned && i === n ? i : i
          if (runEnd - runStart >= minRun) {
            for (let k = Math.max(0, runStart - pad); k < Math.min(n, runEnd + pad); k++) {
              mask[k] = 0
              crashMark[k] = 1
            }
          }
          runStart = -1
        }
      }
    }
  }
  {
    let flightCount = 0
    let crashCount = 0
    for (let i = 0; i < n; i++) {
      if (crashMark[i]) crashCount++
      else if (mask[i]) flightCount++
    }
    metrics.flight = {
      flightPct: (flightCount / n) * 100,
      groundPct: ((n - flightCount - crashCount) / n) * 100,
      crashPinPct: (crashCount / n) * 100,
      frames: flightCount,
    }
    // сегменты-исключения для графиков: земля/посадка дольше 0.3 с + пины
    const minSeg = Math.round(300 / dtMs)
    let segStart = -1
    for (let i = 0; i <= n; i++) {
      const grounded = i < n && !mask[i] && !crashMark[i]
      if (grounded && segStart < 0) segStart = i
      if ((!grounded || i === n) && segStart >= 0) {
        if (i - segStart >= minSeg) {
          metrics.excluded.push({
            fromMs: Math.round(ms(segStart)),
            toMs: Math.round(ms(Math.min(i, n - 1))),
            kind: 'ground',
          })
        }
        segStart = -1
      }
    }
    // пины моторов (столкновение/застревание) — красные зоны для графиков
    segStart = -1
    for (let i = 0; i <= n; i++) {
      const crashed = i < n && crashMark[i] === 1
      if (crashed && segStart < 0) segStart = i
      if ((!crashed || i === n) && segStart >= 0) {
        if (i - segStart >= minSeg) {
          metrics.excluded.push({
            fromMs: Math.round(ms(segStart)),
            toMs: Math.round(ms(Math.min(i, n - 1))),
            kind: 'crash',
          })
        }
        segStart = -1
      }
    }
  }
  if (hasFlightSignal && (metrics.flight.groundPct > 5 || metrics.flight.crashPinPct > 0)) {
    notes.push(
      'Анализ по чистому полёту: ' +
        metrics.flight.flightPct.toFixed(0) +
        '% лога. Исключено: ' +
        metrics.flight.groundPct.toFixed(0) +
        '% земля/посадка' +
        (metrics.flight.crashPinPct > 0
          ? ', ' + metrics.flight.crashPinPct.toFixed(0) + '% пины моторов (столкновение)'
          : '') +
        '.'
    )
  }

  // ---------- throttle & noise ----------
  if (throttleRaw && hasGyro) {
    const thNorm = new Float32Array(n)
    let thMin = Infinity
    let thMax = -Infinity
    for (let i = 0; i < n; i++) {
      const v = throttleRaw[i]
      if (v < thMin) thMin = v
      if (v > thMax) thMax = v
    }
    const range = Math.max(thMax - thMin, 1)
    let thSum = 0
    for (let i = 0; i < n; i++) {
      thNorm[i] = (throttleRaw[i] - thMin) / range
      thSum += thNorm[i]
    }
    metrics.throttleMeanPct = (thSum / n) * 100

    const win = Math.max(5, Math.round(hz * 0.025))
    // exclude manoeuvre frames from noise estimates: any notable stick input or fast rotation
    const maWin = Math.max(5, Math.round(hz * 0.1))
    const quiet = new Uint8Array(n)
    for (let i = maWin; i < n; i++) {
      if (!mask[i]) continue
      let busy = false
      for (let a = 0; a < 3; a++) {
        const spArr = sp[a]
        if (spArr && Math.abs(spArr[i]) > 30) busy = true
      }
      if (!busy) {
        for (let a = 0; a < 3; a++) {
          const g = gyro[a]
          if (g && Math.abs(g[i] - g[i - maWin]) > 60) busy = true
        }
      }
      quiet[i] = busy ? 0 : 1
    }
    const hoverNoise: number[] = []
    const fullNoise: number[] = []
    for (let a = 0; a < 3; a++) {
      if (!gyro[a]) continue
      const ma = movingAverage(gyro[a] as NumArr, win)
      // percentile thresholds считаем только по фреймам полёта
      const sorted: number[] = []
      for (let i = 0; i < n; i++) if (mask[i]) sorted.push(thNorm[i])
      sorted.sort((x, y) => x - y)
      const p40 = sorted[Math.floor(sorted.length * 0.4)]
      const p90 = sorted[Math.floor(sorted.length * 0.9)]
      for (let i = Math.max(win, maWin); i < n; i++) {
        if (!quiet[i]) continue
        const hp = (gyro[a] as NumArr)[i] - ma[i]
        if (thNorm[i] < p40) hoverNoise.push(hp)
        else if (thNorm[i] > p90) fullNoise.push(hp)
      }
    }
    if (hoverNoise.length > 100) metrics.noiseHoverDps = rms(hoverNoise)
    if (fullNoise.length > 100) metrics.noiseFullDps = rms(fullNoise)
    if (metrics.noiseHoverDps && metrics.noiseFullDps) {
      metrics.noiseRatio = metrics.noiseFullDps / Math.max(metrics.noiseHoverDps, 0.1)
    }
  }

  // ---------- motor saturation ----------
  if (hasMotors) {
    const mm = motors as NumArr[]
    let satCount = 0
    let total = 0
    let motorMax = -Infinity
    for (let m = 0; m < mm.length; m++) for (let i = 0; i < n; i++) if (mm[m][i] > motorMax) motorMax = mm[m][i]
    const limit = motorMax > 1500 ? 1950 : 980
    const base = motorMax > 1500 ? 1000 : 0
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue
      let frameMax = -Infinity
      for (let m = 0; m < mm.length; m++) if (mm[m][i] > frameMax) frameMax = mm[m][i]
      if (frameMax > base) total++
      if (frameMax >= limit) satCount++
    }
    metrics.motorSatPct = total > 0 ? (satCount / total) * 100 : null
  }

  // ---------- I-term at hover ----------
  if (axisI.every((x) => x !== null)) {
    if (throttleRaw) {
      const sorted: number[] = []
      for (let i = 0; i < n; i++) sorted.push(throttleRaw[i])
      sorted.sort((x, y) => x - y)
      const lo = sorted[Math.floor(sorted.length * 0.2)]
      const hi = sorted[Math.floor(sorted.length * 0.45)]
      for (let a = 0; a < 3; a++) {
        const arr = axisI[a] as NumArr
        let s = 0
        let c = 0
        for (let i = 0; i < n; i++) {
          if (!mask[i]) continue
          if (throttleRaw[i] >= lo && throttleRaw[i] <= hi) {
            s += Math.abs(arr[i])
            c++
          }
        }
        metrics.itermHover[a] = c > 100 ? s / c : null
      }
    }
  }

  // ---------- step response ----------
  if (hasGyro && hasSetpoint) {
    const preMs = 40
    const postMs = 260
    const preN = Math.round(preMs / dtMs)
    const postN = Math.round(postMs / dtMs)
    const stepThresh = 120 // deg/s
    const quietThresh = 40
    const minGap = Math.round(180 / dtMs)

    const allDelays: number[] = []
    for (let a = 0; a < 3; a++) {
      const spArr = sp[a] as NumArr
      const gArr = gyro[a] as NumArr
      const events: { idx: number; target: number }[] = []
      let i = preN
      while (i < n - postN && events.length < 60) {
        if (!mask[i]) {
          i++
          continue
        }
        const v = Math.abs(spArr[i])
        if (v > stepThresh && Math.abs(spArr[i - 1]) <= stepThresh) {
          // окно события должно быть в чистом полёте (не менее 70% фреймов)
          let maskHits = 0
          for (let k = i - preN; k < i + postN; k++) maskHits += mask[k]
          if (maskHits / (preN + postN) < 0.7) {
            i++
            continue
          }
          // check quiet history
          let quiet = true
          for (let k = i - preN; k < i; k++) {
            if (Math.abs(spArr[k]) > quietThresh) {
              quiet = false
              break
            }
          }
          if (quiet) {
            // find plateau target (median of last 40ms)
            const plateau: number[] = []
            for (let k = i + postN - Math.round(40 / dtMs); k < i + postN; k++) plateau.push(spArr[k])
            plateau.sort((x, y) => x - y)
            const target = plateau[Math.floor(plateau.length / 2)]
            if (Math.abs(target) > stepThresh) {
              events.push({ idx: i, target })
              i += minGap
              continue
            }
          }
        }
        i++
      }

      const overshoots: number[] = []
      const rises: number[] = []
      const settles: number[] = []
      const delays: number[] = []

      for (const ev of events) {
        const tgt = ev.target
        const s0 = spArr[ev.idx - 1]
        const step = tgt - s0
        if (Math.abs(step) < 100) continue
        const win0 = ev.idx - preN
        const win1 = ev.idx + postN
        // gyro relative start
        const g0 = gArr[ev.idx - 1]
        // delay: time between setpoint crossing 10% and gyro crossing 10%
        const t10sp = (idx: number) => {
          for (let k = idx; k < win1; k++) {
            if (Math.abs(spArr[k]) >= Math.abs(step) * 0.1 && Math.sign(spArr[k]) === Math.sign(step)) return k
          }
          return -1
        }
        const t10g = (idx: number) => {
          for (let k = idx; k < win1; k++) {
            if ((gArr[k] - g0) * Math.sign(step) >= Math.abs(step) * 0.1) return k
          }
          return -1
        }
        const isp = t10sp(ev.idx)
        const ig = t10g(ev.idx)
        if (isp >= 0 && ig >= 0) {
          const d = (ig - isp) * dtMs
          delays.push(d)
          allDelays.push(d)
        }
        // overshoot
        let peak = 0
        for (let k = ev.idx; k < win1; k++) {
          const rel = (gArr[k] - g0) * Math.sign(step)
          if (rel > peak) peak = rel
        }
        const os = ((peak - Math.abs(step)) / Math.abs(step)) * 100
        if (os > -50 && os < 200) overshoots.push(os)
        // rise 10-90 (on gyro)
        let t10 = -1
        let t90 = -1
        for (let k = ev.idx; k < win1; k++) {
          const rel = (gArr[k] - g0) * Math.sign(step)
          if (t10 < 0 && rel >= Math.abs(step) * 0.1) t10 = k
          if (t10 >= 0 && rel >= Math.abs(step) * 0.9) {
            t90 = k
            break
          }
        }
        if (t10 >= 0 && t90 > t10) rises.push((t90 - t10) * dtMs)
        // settle: last sample outside ±15% of step
        let settleIdx = -1
        for (let k = win1 - 1; k > ev.idx; k--) {
          const rel = Math.abs((gArr[k] - g0) * Math.sign(step)) - Math.abs(step)
          if (Math.abs(rel) > Math.abs(step) * 0.15) {
            settleIdx = k
            break
          }
        }
        settles.push(settleIdx > 0 ? (settleIdx - ev.idx) * dtMs : postMs)

        // keep a few traces for charts (roll & pitch only, max 8)
        if (a < 2 && metrics.steps.length < 8) {
          const trace: { t: number; sp: number; gyro: number }[] = []
          const stride = Math.max(1, Math.round((win1 - win0) / 140))
          for (let k = win0; k < win1; k += stride) {
            trace.push({ t: Math.round((ms(k) - ms(ev.idx)) * 10) / 10, sp: spArr[k], gyro: Math.round(gArr[k]) })
          }
          metrics.steps.push({ axis: a, t0Ms: Math.round(ms(ev.idx)), target: Math.round(tgt), trace })
        }
      }

      const med = (v: number[]) => (v.length ? v.sort((x, y) => x - y)[Math.floor(v.length / 2)] : null)
      const m = metrics.axes[a]
      m.events = events.length
      m.overshootPct = med(overshoots)
      m.riseMs = med(rises)
      m.settleMs = med(settles)
      m.delayMs = med(delays)
      if (a === 2 && m.overshootPct === null) {
        // yaw rarely has steps; nothing special
      }
    }
    metrics.latencyMs = (() => {
      if (!allDelays.length) return null
      allDelays.sort((x, y) => x - y)
      return allDelays[Math.floor(allDelays.length / 2)]
    })()
  }

  if (!hasGyro) notes.push('В логе нет поля gyroADC — анализ отклика невозможен')
  if (!hasSetpoint) notes.push('В логе нет setpoint/rcCommand — анализ отклика невозможен')
  return metrics
}
