// Проверка влияния компонентов на тюн
import { computeBuild } from '@/components/BuildPanel'
import { computeTune } from '@/lib/tune/engine'
import type { SharpnessProfile } from '@/lib/tune/engine'
import { DEFAULT_SELECTION } from '@/lib/tune/catalog'

function show(name: string, sel: { [k: string]: string }, profile?: SharpnessProfile) {
  const build = computeBuild(sel, 0)
  const tune = computeTune({
    frameClass: build.frameClass,
    auw: build.auw,
    motorKv: build.motorKv,
    rates: { roll: 720, pitch: 720, yaw: 560 },
    expo: 0.15,
    metrics: null,
    hasLog: false,
    influences: build.influences,
    profile,
  })
  console.log('=== ' + name)
  console.log('  influences: ' + build.influences.map((r) => r.target + '=' + r.value).join(', '))
  console.log(
    '  PID r/p: P ' + tune.pid.roll.p + '/' + tune.pid.pitch.p +
    ' D ' + tune.pid.roll.d + '/' + tune.pid.pitch.d +
    ' | gyro_lpf2 ' + tune.filters['gyro_lpf2_static_hz'] +
    ' dyn_notch ' + tune.filters['dyn_notch_count'] +
    ' | ff boost ' + tune.other['feedforward_boost'] + ' tpa ' + tune.other['tpa_rate'] +
    ' | delay ' + tune.delay.totalMs + ' мс (база ' + tune.delay.baseTotalMs + ', Δ ' + tune.delay.deltaMs + ')',
  )
  console.log('  warnings: ' + (tune.warnings.join(' | ') || 'нет'))
  console.log('  объяснения: ' + tune.explanations.map((e) => e.setting + ' → ' + e.to).join('; '))
}

show('стоковая сборка (без влияний)', { ...DEFAULT_SELECTION })
show(
  'VCI Spark 0702 29000 + 4-лопастные + Hummingbird(BMI270)',
  { ...DEFAULT_SELECTION, motor: 'm0702_vci_spark', prop: 'p31_gemfan1220_4', fc: 'fc_nbd_hummingbird' },
)
show(
  'RCinPower GTS V3 0802 25000 + 2-лопастные 40мм (75мм)',
  {
    ...DEFAULT_SELECTION, frame: 'f75_meteor75', motor: 'm0802_rc_gts25',
    prop: 'p40_gemfan2015', battery: 'b_450', fc: 'fc_matrix3in1',
  },
)
show('профиль «Мягкий» (сток, без лога)', { ...DEFAULT_SELECTION }, 'soft')
show('профиль «Максимум» (сток, без лога)', { ...DEFAULT_SELECTION }, 'sharp')
