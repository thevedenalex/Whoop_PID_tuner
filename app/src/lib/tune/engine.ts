// Tuning engine: base racing tunes for 65/75 mm whoops + corrections from
// AUW (components), actual rates and blackbox log metrics.

import type { LogMetrics } from '../analyze/metrics'
import type { LogSettings } from '../bbl/settings'
import type { FrameClass, InfluenceRule } from './catalog'

export interface AxisPid {
  p: number
  i: number
  d: number
}

// Оценка групповой задержки фильтров (мс) — по текущим настройкам и относительно базы
export interface DelayEstimate {
  gyroMs: number
  dtermMs: number
  totalMs: number
  baseTotalMs: number
  // deltaMs: + — добавлено задержки ради стабильности, − — снято
  deltaMs: number
  logTotalMs: number | null // задержка фильтров, реально летавших при записи лога
  notchCount: number
  lpf2: number
}

export interface TuneResult {
  pid: { roll: AxisPid; pitch: AxisPid; yaw: AxisPid }
  filters: { [key: string]: number }
  other: { [key: string]: number | string }
  cli: string[]
  explanations: Explanation[]
  warnings: string[]
  score: number | null
  frameClass: FrameClass
  auw: number
  delay: DelayEstimate
}

export interface Explanation {
  setting: string
  from: string
  to: string
  reason: string
}

// Профиль резкости: мягкий (плавность) / гоночный (баланс) / максимум (минимальная задержка)
export type SharpnessProfile = 'soft' | 'race' | 'sharp'

export interface TuneInput {
  frameClass: FrameClass
  auw: number // all-up weight incl. battery, grams
  motorKv: number | null
  rates: { roll: number; pitch: number; yaw: number } // max deg/s per axis
  expo: number // 0..1 center softness
  metrics: LogMetrics | null
  hasLog: boolean
  influences?: InfluenceRule[]
  profile?: SharpnessProfile
  // фактические настройки из заголовков лога (PID/фильтры) — для «сейчас → рекомендуем»
  logSettings?: LogSettings | null
}

interface BaseTune {
  pid: { roll: AxisPid; pitch: AxisPid; yaw: AxisPid }
  filters: { [key: string]: number }
  other: { [key: string]: number | string }
}

const BASE_65: BaseTune = {
  pid: {
    roll: { p: 48, i: 78, d: 34 },
    pitch: { p: 50, i: 82, d: 36 },
    yaw: { p: 46, i: 72, d: 0 },
  },
  filters: {
    gyro_lpf1_static_hz: 0,
    gyro_lpf2_static_hz: 300,
    gyro_lpf2_type: 1, // PT1
    dyn_notch_count: 3,
    dyn_notch_q: 450,
    dyn_notch_min_hz: 140,
    dyn_notch_max_hz: 400,
    dterm_lpf1_dyn_min_hz: 60,
    dterm_lpf1_dyn_max_hz: 110,
    dterm_lpf1_type: 1,
    dterm_lpf2_static_hz: 150,
    dterm_lpf2_type: 1,
    yaw_lowpass_hz: 0,
  },
  other: {
    tpa: 0,
    tpa_breakpoint: 1650,
    iterm_relax: 2, // setpoint
    iterm_relax_cutoff: 10,
    antigravity_gain: 90,
    feedforward_transition: 0,
    feedforward_boost: 5,
    feedforward_gain: 50,
    motor_output_limit: 100,
  },
}

const BASE_75: BaseTune = {
  pid: {
    roll: { p: 52, i: 86, d: 38 },
    pitch: { p: 54, i: 90, d: 40 },
    yaw: { p: 48, i: 78, d: 0 },
  },
  filters: {
    gyro_lpf1_static_hz: 0,
    gyro_lpf2_static_hz: 280,
    gyro_lpf2_type: 1,
    dyn_notch_count: 3,
    dyn_notch_q: 450,
    dyn_notch_min_hz: 120,
    dyn_notch_max_hz: 380,
    dterm_lpf1_dyn_min_hz: 55,
    dterm_lpf1_dyn_max_hz: 105,
    dterm_lpf1_type: 1,
    dterm_lpf2_static_hz: 140,
    dterm_lpf2_type: 1,
    yaw_lowpass_hz: 0,
  },
  other: {
    tpa: 0,
    tpa_breakpoint: 1650,
    iterm_relax: 2,
    iterm_relax_cutoff: 10,
    antigravity_gain: 95,
    feedforward_transition: 0,
    feedforward_boost: 5,
    feedforward_gain: 50,
    motor_output_limit: 100,
  },
}

const REF_AUW: { [k in FrameClass]: number } = { '65': 26, '75': 34 }

function clampPid(v: number) {
  return Math.max(1, Math.min(250, Math.round(v)))
}

// Групповая задержка фильтров, мс. PT1: τ ≈ 1/(2π·fc); динамический нотч: τ ≈ Q/(π·f0)
// на центральной частоте диапазона. Оценка по типовым частотам сигнала.
function pathDelayMs(f: { [key: string]: number }): { gyro: number; dterm: number } {
  const pt1 = (fc: number) => (fc > 0 ? 1000 / (2 * Math.PI * fc) : 0)
  let gyro = pt1(f['gyro_lpf2_static_hz'] || 0)
  const n = f['dyn_notch_count'] || 0
  const f0 = ((f['dyn_notch_min_hz'] || 0) + (f['dyn_notch_max_hz'] || 0)) / 2
  if (n > 0 && f0 > 0) gyro += (n * 1000 * ((f['dyn_notch_q'] || 450) / 100)) / (Math.PI * f0)
  const dMid = ((f['dterm_lpf1_dyn_min_hz'] || 0) + (f['dterm_lpf1_dyn_max_hz'] || 0)) / 2
  const dterm = pt1(dMid) + pt1(f['dterm_lpf2_static_hz'] || 0)
  return { gyro, dterm }
}

// Задержка фильтров, реально летавших при записи лога. Отличия от расчёта для рекомендаций:
// учитываем тип фильтра (BIQUAD ≈ ×1.9 от PT1), динамический gyro_lpf1 и статический dterm_lpf1.
function logPathDelayMs(s: LogSettings): { gyro: number; dterm: number } {
  const f = s.filters
  const lpf = (fc: number, type: number) => (fc > 0 ? (1000 / (2 * Math.PI * fc)) * (type === 1 ? 1 : 1.9) : 0)
  let gyro = 0
  if (f['gyro_lpf1_static_hz'] > 0) gyro += lpf(f['gyro_lpf1_static_hz'], f['gyro_lpf1_type'])
  else if (f['gyro_lpf1_dyn_max_hz'] > 0)
    gyro += lpf((f['gyro_lpf1_dyn_min_hz'] + f['gyro_lpf1_dyn_max_hz']) / 2, f['gyro_lpf1_type'])
  gyro += lpf(f['gyro_lpf2_static_hz'], f['gyro_lpf2_type'])
  const n = f['dyn_notch_count'] || 0
  const f0 = (f['dyn_notch_min_hz'] + f['dyn_notch_max_hz']) / 2
  if (n > 0 && f0 > 0) gyro += (n * 1000 * (f['dyn_notch_q'] / 100)) / (Math.PI * f0)
  const dDyn = (f['dterm_lpf1_dyn_min_hz'] + f['dterm_lpf1_dyn_max_hz']) / 2
  const dMid = dDyn > 0 ? dDyn : f['dterm_lpf1_static_hz']
  const dterm = lpf(dMid, f['dterm_lpf1_type']) + lpf(f['dterm_lpf2_static_hz'], f['dterm_lpf2_type'])
  return { gyro, dterm }
}

export function computeTune(input: TuneInput): TuneResult {
  const base = (input.frameClass === '75' ? BASE_75 : BASE_65).pid
  const filters = { ...(input.frameClass === '75' ? BASE_75 : BASE_65).filters }
  const other = { ...(input.frameClass === '75' ? BASE_75 : BASE_65).other }
  const expl: Explanation[] = []
  const warn: string[] = []

  const pid = {
    roll: { ...base.roll },
    pitch: { ...base.pitch },
    yaw: { ...base.yaw },
  }

  const addExpl = (setting: string, from: string, to: string, reason: string) => {
    if (from !== to) expl.push({ setting, from, to, reason })
  }

  // «Исходное» значение для объяснений: фактическое из лога, если оно прочитано, иначе база
  const sLog = input.logSettings && input.logSettings.hasPid ? input.logSettings : null
  const cur = (ax: 'roll' | 'pitch' | 'yaw', letter: 'p' | 'i' | 'd'): string =>
    sLog ? String(sLog.pid[ax][letter]) : String(base[ax][letter])
  const fFrom = (k: string): string =>
    sLog && input.logSettings ? k + ' ' + (input.logSettings.filters[k] ?? 0) : 'база'

  // ---------- weight correction ----------
  const ref = REF_AUW[input.frameClass]
  const delta = input.auw - ref
  if (Math.abs(delta) >= 4) {
    const steps = Math.trunc(delta / 5) // ±1 per 5g
    const dir = steps > 0 ? 'тяжелее' : 'легче'
    const dp = Math.max(-4, Math.min(4, steps * 2))
    const di = Math.max(-15, Math.min(20, steps * 6))
    const dd = Math.max(-4, Math.min(6, steps * 2))
    pid.roll.p = clampPid(pid.roll.p + dp)
    pid.pitch.p = clampPid(pid.pitch.p + dp)
    pid.roll.i = clampPid(pid.roll.i + di)
    pid.pitch.i = clampPid(pid.pitch.i + di)
    pid.yaw.i = clampPid(pid.yaw.i + di)
    pid.roll.d = clampPid(pid.roll.d + dd)
    pid.pitch.d = clampPid(pid.pitch.d + dd)
    addExpl(
      'P/I/D',
      'база ' + input.frameClass + ' мм',
      `P ${dp >= 0 ? '+' : ''}${dp}, I ${di >= 0 ? '+' : ''}${di}, D ${dd >= 0 ? '+' : ''}${dd}`,
      `Взлётный вес ${input.auw} г — на ${Math.abs(delta)} г ${dir} референса (${ref} г): ` +
        (delta > 0
          ? 'массе нужны больше авторитет и интегральная составляющая'
          : 'лёгкой сборке хватает меньших усилий, снижаем нагрев')
    )
    if (delta > 8) {
      warn.push(`Сборка сильно тяжелее референса для ${input.frameClass} мм — рассмотрите более ёмкий аккумулятор и KV моторов, иначе просадки на панч-аут`)
    }
  }

  // ---------- component influences (beyond weight) ----------
  for (const rule of input.influences || []) {
    if (rule.target === 'pAdj') {
      pid.roll.p = clampPid(pid.roll.p + rule.value)
      pid.pitch.p = clampPid(pid.pitch.p + rule.value)
    } else if (rule.target === 'dAdj') {
      pid.roll.d = clampPid(pid.roll.d + rule.value)
      pid.pitch.d = clampPid(pid.pitch.d + rule.value)
    } else if (rule.target === 'lpf2Delta') {
      filters.gyro_lpf2_static_hz = Math.max(150, Math.min(350, filters.gyro_lpf2_static_hz + rule.value))
    } else if (rule.target === 'lpf2Cap') {
      filters.gyro_lpf2_static_hz = Math.min(filters.gyro_lpf2_static_hz, rule.value)
    } else if (rule.target === 'dynNotchMin') {
      filters.dyn_notch_count = Math.max(filters.dyn_notch_count, rule.value)
    }
    if (rule.desc) {
      addExpl('Компоненты', 'база', rule.desc, rule.reason)
    }
  }

  // motors KV / prop aggression
  if (input.motorKv && input.motorKv >= 24000) {
    pid.roll.d = clampPid(pid.roll.d - 2)
    pid.pitch.d = clampPid(pid.pitch.d - 2)
    addExpl('D roll/pitch', cur('roll', 'd'), String(pid.roll.d), 'Высокие KV → больше шума и нагрев D-члена, чуть снижаем D')
  }
  if (input.motorKv && input.motorKv >= 28000) {
    pid.roll.d = clampPid(pid.roll.d - 2)
    pid.pitch.d = clampPid(pid.pitch.d - 2)
    warn.push('Экстремальные KV (≥28000): моторы сильно греются — не трогайте их сразу после приземления и проверяйте нагрев после пака')
    addExpl('D roll/pitch', cur('roll', 'd'), String(pid.roll.d), 'KV ≥28000 — ещё чуть снимаем D от нагрева')
  }

  // ---------- rates ----------
  const rpMax = Math.max(input.rates.roll, input.rates.pitch)
  if (rpMax >= 800) {
    other.feedforward_transition = 0
    other.iterm_relax_cutoff = 12
    addExpl('iterm_relax_cutoff', '10', '12', 'Высокие рейты (≥800°/с): быстрые движения — ускоряем расслабление I-term, чтобы не было отскока')
  } else if (rpMax <= 600) {
    warn.push('Для гонок рейты roll/pitch обычно 700–900°/с — текущие низкие, дрон будет вялым на стиках')
  }
  if (input.rates.yaw <= 500) {
    warn.push('Yaw ≤ 500°/с — для гонок обычно 550–800°/с')
  }

  // ---------- log-based corrections ----------
  // Пороги анализа зависят от профиля резкости: «мягкий» терпит больше перелёта,
  // «максимум» требует жёстких стопов и раньше добавляет P/D.
  const prof = input.profile ?? 'race'
  const th =
    prof === 'soft'
      ? { osStrong: 20, osMild: 12, boostBelow: 2, noiseBoost: 2.4, settle: 160, dStrong: 4, pStrong: -1, dMild: 2, boostP: 2, boostD: 2 }
      : prof === 'sharp'
        ? { osStrong: 12, osMild: 6, boostBelow: 4, noiseBoost: 2.0, settle: 110, dStrong: 6, pStrong: -2, dMild: 3, boostP: 5, boostD: 4 }
        : { osStrong: 15, osMild: 8, boostBelow: 3, noiseBoost: 2.2, settle: 130, dStrong: 5, pStrong: -2, dMild: 2, boostP: 4, boostD: 3 }
  let score: number | null = null
  const m = input.metrics
  if (input.hasLog && m) {
    if (!m.hasGyro) warn.push('В логе нет gyroADC — лог-анализ недоступен')

    // overshoot on roll/pitch
    const rpOvers = [m.axes[0].overshootPct, m.axes[1].overshootPct]
    for (let a = 0; a < 2; a++) {
      const os = rpOvers[a]
      if (os === null) continue
      const ax = a === 0 ? pid.roll : pid.pitch
      const nm = a === 0 ? 'roll' : 'pitch'
      if (os > th.osStrong) {
        ax.d = clampPid(ax.d + th.dStrong)
        ax.p = clampPid(ax.p + th.pStrong)
        addExpl(`D ${nm}`, cur(nm, 'd'), String(ax.d), `Перелёт ${os.toFixed(0)}% — не хватает демпфирования, добавляем D и чуть снимаем P`)
      } else if (os > th.osMild) {
        ax.d = clampPid(ax.d + th.dMild)
        addExpl(`D ${nm}`, cur(nm, 'd'), String(ax.d), `Перелёт ${os.toFixed(0)}% — умеренно добавляем D`)
      } else if (os < th.boostBelow && (m.noiseRatio ?? 99) < th.noiseBoost) {
        ax.p = clampPid(ax.p + th.boostP)
        ax.d = clampPid(ax.d + th.boostD)
        addExpl(`P/D ${nm}`, `P ${cur(nm, 'p')}, D ${cur(nm, 'd')}`, `P ${ax.p}, D ${ax.d}`, `Перелёт ${os.toFixed(0)}% и низкий шум — можно агрессивнее для резких стопов`)
      }
    }

    // settle time
    for (let a = 0; a < 2; a++) {
      const st = m.axes[a].settleMs
      if (st === null) continue
      if (st > th.settle) {
        const ax = a === 0 ? pid.roll : pid.pitch
        const nm = a === 0 ? 'roll' : 'pitch'
        ax.d = clampPid(ax.d + 3)
        addExpl(`D ${nm}`, cur(nm, 'd'), String(ax.d), `Время установления ${st.toFixed(0)} мс — раскачка, добавляем D`)
      }
    }

    // noise
    if (m.noiseFullDps !== null && m.noiseHoverDps !== null) {
      const ratio = m.noiseRatio ?? 0
      if (m.noiseFullDps > 28 || ratio > 2.6) {
        filters.gyro_lpf2_static_hz = Math.min(filters.gyro_lpf2_static_hz, 250)
        filters.dyn_notch_count = 4
        filters.dyn_notch_min_hz = Math.min(filters.dyn_notch_min_hz, 130)
        filters.dterm_lpf1_dyn_max_hz = Math.min(filters.dterm_lpf1_dyn_max_hz, 100)
        pid.roll.d = clampPid(pid.roll.d - 2)
        pid.pitch.d = clampPid(pid.pitch.d - 2)
        addExpl(
          'Фильтры',
          fFrom('gyro_lpf2_static_hz') + ' · notch ×' + (sLog && input.logSettings ? input.logSettings.filters['dyn_notch_count'] : 3),
          'gyro_lpf2 250, dyn_notch x4, dterm dyn ≤100',
          `Шум на газе ${m.noiseFullDps.toFixed(0)}°/с (x${ratio.toFixed(1)} к ховеру) — ужесточаем фильтрацию, чуть снимаем D от нагрева`
        )
        if (m.noiseFullDps > 45) {
          warn.push('Очень высокий шум на газе — проверьте балансировку пропов, подшипники моторов и трещины рамы')
        }
      } else if (ratio < 1.6 && m.noiseFullDps < 18) {
        filters.gyro_lpf2_static_hz = Math.min(350, filters.gyro_lpf2_static_hz + 40)
        filters.dyn_notch_min_hz = filters.dyn_notch_min_hz + 20
        filters.dterm_lpf1_dyn_min_hz = filters.dterm_lpf1_dyn_min_hz + 15
        addExpl(
          'Фильтры',
          fFrom('gyro_lpf2_static_hz'),
          'gyro_lpf2 +' + (filters.gyro_lpf2_static_hz - 300) + ', dyn_notch min +' + 20,
          'Шум низкий — ослабляем фильтры для минимальной задержки (гоночный профиль)'
        )
      }
    }

    // motor saturation
    if (m.motorSatPct !== null && m.motorSatPct > 3) {
      other.tpa = 0.55
      other.tpa_breakpoint = 1650
      addExpl(
        'TPA',
        'off',
        '0.55 @ 1650',
        `Моторы в упор ${m.motorSatPct.toFixed(1)}% времени — TPA сгладит пик и уберёт «натяжку» на высоком газе`
      )
    }

    // latency
    if (m.latencyMs !== null && m.latencyMs > 25) {
      warn.push(`Задержка отклика ${m.latencyMs.toFixed(0)} мс — проверьте фильтры (gyro_lpf1 должен быть 0), RPM-фильтр и состояние моторов`)
    }

    // iterm hover load
    const it = m.itermHover
    if (it[0] !== null && it[0] > 45) {
      pid.roll.i = clampPid(pid.roll.i + 8)
      pid.pitch.i = clampPid(pid.pitch.i + 8)
      addExpl('I roll/pitch', cur('roll', 'i'), String(pid.roll.i), 'В ховере I-term постоянно перекошен (ЦТ смещён или перекос) — добавляем запас I, проверьте центровку')
    }

    // yaw bounce
    const yos = m.axes[2].overshootPct
    if (yos !== null && yos > 20) {
      pid.yaw.p = clampPid(pid.yaw.p - 3)
      addExpl('P yaw', cur('yaw', 'p'), String(pid.yaw.p), `Yaw перелетает ${yos.toFixed(0)}% — чуть снижаем P yaw (D на yaw обычно 0)`)
    }

    // score
    score = 100
    const osOk = (v: number | null) => v === null || (v >= 2 && v <= 12)
    if (!osOk(m.axes[0].overshootPct)) score -= 20
    if (!osOk(m.axes[1].overshootPct)) score -= 20
    const st0 = m.axes[0].settleMs
    if (st0 !== null && st0 > 120) score -= 15
    const st1 = m.axes[1].settleMs
    if (st1 !== null && st1 > 120) score -= 15
    if ((m.noiseRatio ?? 0) > 2.6) score -= 15
    if ((m.motorSatPct ?? 0) > 3) score -= 10
    if (m.latencyMs !== null && m.latencyMs > 25) score -= 10
    if (!m.hasGyro) score = null
    else score = Math.max(5, score)
  }

  // ---------- profile overlay (поверх всех коррекций) ----------
  if (prof === 'soft') {
    pid.roll.p = clampPid(pid.roll.p - 3)
    pid.pitch.p = clampPid(pid.pitch.p - 3)
    pid.yaw.p = clampPid(pid.yaw.p - 2)
    pid.roll.d = clampPid(pid.roll.d - 2)
    pid.pitch.d = clampPid(pid.pitch.d - 2)
    filters.gyro_lpf2_static_hz = Math.max(150, filters.gyro_lpf2_static_hz - 30)
    other.feedforward_gain = 35
    other.feedforward_boost = 0
    other.iterm_relax_cutoff = 8
    other.antigravity_gain = (other.antigravity_gain as number) - 15
    addExpl(
      'Профиль «Мягкий»',
      'гоночная база',
      'P −3, D −2, фильтры ↑, FF gain 35',
      'Плавный отклик без рывков — для спокойного indoor-полёта и отработки траекторий'
    )
  } else if (prof === 'sharp') {
    const noiseOk = !m || m.noiseFullDps === null || m.noiseFullDps < 18
    pid.roll.p = clampPid(pid.roll.p + 3)
    pid.pitch.p = clampPid(pid.pitch.p + 3)
    pid.yaw.p = clampPid(pid.yaw.p + 4)
    if (noiseOk) {
      pid.roll.d = clampPid(pid.roll.d + 3)
      pid.pitch.d = clampPid(pid.pitch.d + 3)
      filters.gyro_lpf2_static_hz = Math.min(350, filters.gyro_lpf2_static_hz + 30)
      // чистый лог — главный источник задержки (динамические нотчи) можно сократить
      if (filters.dyn_notch_count > 2) filters.dyn_notch_count = 2
    } else {
      warn.push('Профиль «Максимум резкости»: в логе шум выше 18°/с — P и feedforward добавили, но D и фильтры не ослабляем, пока не уберёте источник шума (балансировка пропов, подшипники, рама)')
    }
    other.feedforward_gain = 80
    other.feedforward_boost = 10
    other.iterm_relax_cutoff = 15
    other.antigravity_gain = (other.antigravity_gain as number) + 10
    const sharpBits = ['P +3/+3/+4 yaw', 'FF gain 80, boost 10']
    if (noiseOk) sharpBits.push('D +3', 'фильтры ↓ (notch ×' + filters.dyn_notch_count + ')')
    addExpl('Профиль «Максимум»', 'гоночная база', sharpBits.join(', '), 'Минимальная задержка и жёсткие стопы — максимум резкости на стиках')
  }

  // ---------- оценка задержки фильтров ----------
  const curDelay = pathDelayMs(filters)
  const baseDelay = pathDelayMs((input.frameClass === '75' ? BASE_75 : BASE_65).filters)
  const round1 = (v: number) => Math.round(v * 10) / 10
  let logTotalMs: number | null = null
  if (input.logSettings) {
    const ld = logPathDelayMs(input.logSettings)
    logTotalMs = round1(ld.gyro + ld.dterm)
  }
  const delay: DelayEstimate = {
    gyroMs: round1(curDelay.gyro),
    dtermMs: round1(curDelay.dterm),
    totalMs: round1(curDelay.gyro + curDelay.dterm),
    baseTotalMs: round1(baseDelay.gyro + baseDelay.dterm),
    deltaMs: round1(curDelay.gyro + curDelay.dterm - baseDelay.gyro - baseDelay.dterm),
    logTotalMs,
    notchCount: filters.dyn_notch_count,
    lpf2: filters.gyro_lpf2_static_hz,
  }

  // ---------- CLI ----------
  const cli: string[] = [
    '# PID Lab — ' + input.frameClass + ' mm, AUW ' + input.auw.toFixed(1) + ' g',
    `set p_roll = ${pid.roll.p}`,
    `set i_roll = ${pid.roll.i}`,
    `set d_roll = ${pid.roll.d}`,
    `set p_pitch = ${pid.pitch.p}`,
    `set i_pitch = ${pid.pitch.i}`,
    `set d_pitch = ${pid.pitch.d}`,
    `set p_yaw = ${pid.yaw.p}`,
    `set i_yaw = ${pid.yaw.i}`,
    `set d_yaw = ${pid.yaw.d}`,
  ]
  for (const k of Object.keys(filters)) cli.push(`set ${k} = ${filters[k]}`)
  for (const k of Object.keys(other)) cli.push(`set ${k} = ${other[k]}`)
  cli.push('save')

  return {
    pid,
    filters,
    other,
    cli,
    explanations: expl,
    warnings: warn,
    score,
    frameClass: input.frameClass,
    auw: input.auw,
    delay,
  }
}
