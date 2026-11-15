// Проверка: движок тюна корректно учитывает все типы влияния компонентов,
// включая недавно добавленные позиции каталога.
import { describe, it, expect } from 'vitest'
import { computeBuild } from './src/components/BuildPanel'
import { computeTune } from './src/lib/tune/engine'
import { CATEGORIES, DEFAULT_SELECTION } from './src/lib/tune/catalog'

function tune(selection: Partial<{ [k: string]: string }>, extra = 0, profile: 'soft' | 'race' | 'sharp' = 'race') {
  const build = computeBuild({ ...DEFAULT_SELECTION, ...selection }, extra)
  return { build, res: computeTune({
    frameClass: build.frameClass,
    auw: build.auw,
    motorKv: build.motorKv,
    rates: { roll: 720, pitch: 720, yaw: 640 },
    expo: 0.2,
    metrics: null,
    hasLog: false,
    influences: build.influences,
    profile,
  }) }
}

// база без коррекций: вес эталонный, нейтральные компоненты
function base65() {
  return computeTune({
    frameClass: '65', auw: 26, motorKv: null,
    rates: { roll: 720, pitch: 720, yaw: 640 }, expo: 0.2,
    metrics: null, hasLog: false,
  })
}

describe('каталог: новые компоненты валидны', () => {
  it('у всех моторов задан KV, у новых рам — класс, у пропов — лопасти', () => {
    for (const cat of CATEGORIES) {
      for (const it of cat.items) {
        if (cat.id === 'motor') expect(typeof it.kv, it.name).toBe('number')
        if (cat.id === 'frame') expect(it.cls, it.name).toMatch(/^(65|75)$/)
        if (cat.id === 'prop') expect(typeof it.blades, it.name).toBe('number')
      }
    }
  })
  it('id уникальны', () => {
    const ids = CATEGORIES.flatMap((c) => c.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('вес и класс рамы', () => {
  it('карбоновый усилитель добавляет вес и меняет AUW', () => {
    const plain = computeBuild({ ...DEFAULT_SELECTION, frame: 'f75_cockroach75' }, 0)
    const brace = computeBuild({ ...DEFAULT_SELECTION, frame: 'f75_cockroach75_cb' }, 0)
    expect(brace.auw - plain.auw).toBeCloseTo(0.7, 5)
    expect(plain.frameClass).toBe('75')
  })
  it('75 мм — база 75 класса (с учётом коррекции на лёгкий вес)', () => {
    const { res } = tune({ frame: 'f75_cockroach75' })
    expect(res.frameClass).toBe('75')
    // AUW ~25.4 г против референса 34 г → шаг −1: P −2, I −6, D −2
    expect(res.pid.pitch.p).toBe(52)
  })
})

describe('моторы', () => {
  it('подшипниковый мотор даёт D +1', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, motor: 'm0702_rc_gts' }, 0) // ball bearing
    expect(b.influences.some((r) => r.target === 'dAdj' && r.value === 1)).toBe(true)
  })
  it('VCI 29000KV (ball): KV ≥28000 → D −4 от KV и предупреждение', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, motor: 'm0702_vci_spark' }, 0)
    expect(b.motorKv).toBe(29000)
    const res = computeTune({
      frameClass: b.frameClass, auw: 26, motorKv: b.motorKv,
      rates: { roll: 720, pitch: 720, yaw: 640 }, expo: 0.2,
      metrics: null, hasLog: false, influences: b.influences,
    })
    const base = base65()
    // D: база 34, KV −2−2, подшипник +1 → 31
    expect(res.pid.roll.d).toBe(base.pid.roll.d - 3)
    expect(res.warnings.some((w) => w.includes('Экстремальные KV'))).toBe(true)
  })
})

describe('пропеллеры', () => {
  it('агрессивный 4-лопастной (Gemfan 1636-4): D нетто 0, lpf2 −30, нотчи ≥4', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, prop: 'p40_gemfan1636' }, 0)
    const dAdj = b.influences.filter((r) => r.target === 'dAdj').reduce((s, r) => s + r.value, 0)
    expect(dAdj).toBe(0) // −1 (4 лопасти) +1 (агрессивный шаг)
    expect(b.influences.some((r) => r.target === 'lpf2Delta' && r.value === -30)).toBe(true)
    expect(b.influences.some((r) => r.target === 'dynNotchMin' && r.value === 4)).toBe(true)
  })
  it('лёгкий 2-лопастной (HQ UL 40MMX2): P +1, D +1, lpf2 +30', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, prop: 'p40_hq_ul' }, 0)
    expect(b.influences.some((r) => r.target === 'pAdj' && r.value === 1)).toBe(true)
    const dAdj = b.influences.filter((r) => r.target === 'dAdj').reduce((s, r) => s + r.value, 0)
    expect(dAdj).toBe(1)
    const lpf = b.influences.filter((r) => r.target === 'lpf2Delta').reduce((s, r) => s + r.value, 0)
    expect(lpf).toBe(30)
  })
  it('средний 3-лопастной (Gemfan 1219S) не даёт влияний', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, prop: 'p31_gemfan1219s' }, 0)
    expect(b.influences.filter((r) => r.target !== 'lpf2Delta')).toHaveLength(0)
    expect(b.influences).toHaveLength(0)
  })
  it('1611-3 (light, 3 лопасти): только P +1 и lpf2 +10', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, prop: 'p40_gemfan1611' }, 0)
    expect(b.influences.some((r) => r.target === 'pAdj' && r.value === 1)).toBe(true)
    expect(b.influences.filter((r) => r.target === 'dAdj')).toHaveLength(0)
  })
})

describe('платы FC (гироскопы)', () => {
  it('BMI270 (Hummingbird V4) ограничивает gyro_lpf2 ≤290', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, fc: 'fc_nbd_hummingbird' }, 0)
    const res = computeTune({
      frameClass: '65', auw: 26, motorKv: null,
      rates: { roll: 720, pitch: 720, yaw: 640 }, expo: 0.2,
      metrics: null, hasLog: false, influences: b.influences,
    })
    expect(res.filters.gyro_lpf2_static_hz).toBeLessThanOrEqual(290)
  })
  it('MPU6000 (BeeBrain BLV5) ограничивает gyro_lpf2 ≤250', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, fc: 'fc_nbd_beebrain' }, 0)
    const res = computeTune({
      frameClass: '65', auw: 26, motorKv: null,
      rates: { roll: 720, pitch: 720, yaw: 640 }, expo: 0.2,
      metrics: null, hasLog: false, influences: b.influences,
    })
    expect(res.filters.gyro_lpf2_static_hz).toBeLessThanOrEqual(250)
  })
  it('Matrix 3-in-1 ICM42688: чистый сигнал — gyro_lpf2 выше базы', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, fc: 'fc_matrix3in1' }, 0)
    const res = computeTune({
      frameClass: '65', auw: 26, motorKv: null,
      rates: { roll: 720, pitch: 720, yaw: 640 }, expo: 0.2,
      metrics: null, hasLog: false, influences: b.influences,
    })
    expect(res.filters.gyro_lpf2_static_hz).toBe(320) // база 300 + 20
  })
  it('Matrix 3-in-1 BMI270: ограничение gyro_lpf2 ≤290', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, fc: 'fc_matrix3in1_bmi' }, 0)
    const res = computeTune({
      frameClass: '65', auw: 26, motorKv: null,
      rates: { roll: 720, pitch: 720, yaw: 640 }, expo: 0.2,
      metrics: null, hasLog: false, influences: b.influences,
    })
    expect(res.filters.gyro_lpf2_static_hz).toBeLessThanOrEqual(290)
  })
  it('плата без указанного гироскопа — без влияния на lpf2', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, fc: 'fc_f4_5a' }, 0)
    expect(b.influences.filter((r) => r.target === 'lpf2Cap' || r.target === 'lpf2Delta')).toHaveLength(0)
  })
})

describe('объяснения покрывают влияния', () => {
  it('для каждого влияния с desc есть строка в explanations', () => {
    const b = computeBuild({ ...DEFAULT_SELECTION, motor: 'm0702_vci_spark', prop: 'p40_gemfan1636' }, 0)
    const res = computeTune({
      frameClass: b.frameClass, auw: b.auw, motorKv: b.motorKv,
      rates: { roll: 720, pitch: 720, yaw: 640 }, expo: 0.2,
      metrics: null, hasLog: false, influences: b.influences,
    })
    const descs = b.influences.filter((r) => r.desc).map((r) => r.reason)
    for (const r of descs) expect(res.explanations.some((e) => e.reason === r)).toBe(true)
  })
})
