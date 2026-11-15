// Проверка извлечения настроек из .bbl и расчёта «сейчас → рекомендуем»
import { readFileSync } from 'fs'
import { parseBbl } from '@/lib/bbl/parser'
import { extractLogSettings } from '@/lib/bbl/settings'
import { computeTune } from '@/lib/tune/engine'

const buf = new Uint8Array(readFileSync(process.argv[2] || '../testlogs/UWL75.BBL'))
const idx = parseInt(process.argv[3] || '3', 10)
const log = await parseBbl(buf, idx)
const s = extractLogSettings(log.headers)
if (!s) throw new Error('настройки не извлечены')
console.log('PID из лога: roll ' + s.pid.roll.p + '/' + s.pid.roll.i + '/' + s.pid.roll.d +
  ' pitch ' + s.pid.pitch.p + '/' + s.pid.pitch.i + '/' + s.pid.pitch.d +
  ' yaw ' + s.pid.yaw.p + '/' + s.pid.yaw.i + '/' + s.pid.yaw.d)
console.log('Фильтры из лога: ' + JSON.stringify(s.filters))
console.log('Прочее из лога: ' + JSON.stringify(s.other))

const tune = computeTune({
  frameClass: '75',
  auw: 38,
  motorKv: 22000,
  rates: { roll: 760, pitch: 740, yaw: 700 },
  expo: 0.2,
  metrics: null,
  hasLog: false,
  profile: 'sharp',
  logSettings: s,
})
console.log('Задержка: рекомендация ' + tune.delay.totalMs + ' мс · из лога ' + tune.delay.logTotalMs + ' мс · база ' + tune.delay.baseTotalMs + ' мс')
console.log('Объяснения (from → to):')
for (const e of tune.explanations) console.log('  ' + e.setting + ': ' + e.from + ' → ' + e.to)
