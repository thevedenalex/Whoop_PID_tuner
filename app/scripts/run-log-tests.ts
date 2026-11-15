// Проверка декодера и анализатора на реальных .bbl-логах.
// Запуск: esbuild --bundle → node. Путь к папке с логами — первый аргумент.
import { readFileSync, readdirSync } from 'fs'
import { parseBbl, countLogs } from '@/lib/bbl/parser'
import { analyzeLog } from '@/lib/analyze/metrics'

const dir = process.argv[2] || '../testlogs'
const files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.bbl'))
if (files.length === 0) {
  console.log('no .bbl files in ' + dir)
  process.exit(1)
}

async function main() {
for (const name of files) {
  const buf = new Uint8Array(readFileSync(dir + '/' + name))
  const nLogs = countLogs(buf)
  console.log('=== ' + name + ' — логов в файле: ' + nLogs)
  let cleanEnds = 0
  let totalFrames = 0
  for (let i = 0; i < nLogs; i++) {
    const t0 = Date.now()
    let line: string
    try {
      const log = await parseBbl(buf, i)
      if (log.stopReason.indexOf('LOG_END') !== -1 || log.stopReason.indexOf('следующего лога') !== -1) cleanEnds++
      totalFrames += log.frameCount
      const dt = Date.now() - t0
      const m = analyzeLog(log)
      const h = log.headers
      line =
        '  [' + i + '] ' +
        (h['Firmware revision'] || h['Firmware type'] || '?') +
        ' | craft "' + (h['Craft name'] || '') + '"' +
        ' | frames ' + log.frameCount +
        (log.truncated ? ' | TRUNCATED: ' + log.stopReason : ' | ' + log.stopReason) +
        ' | ' + (log.durationMs / 1000).toFixed(1) + ' s' +
        ' | loopHz ' + log.loopHz +
        ' | rates_type ' + (h['rates_type'] || '?') +
        ' | motors ' + log.motorCount +
        ' | parse ' + dt + ' ms'
      console.log(line)
      console.log(
        '      overshoot %: ' +
          m.axes.map((a) => (a.overshootPct === null ? 'null' : a.overshootPct.toFixed(1))).join(' / ') +
          ' | settle ms: ' +
          m.axes.map((a) => (a.settleMs === null ? 'null' : a.settleMs.toFixed(0))).join(' / ') +
          ' | noise hover/gas: ' +
          (m.noiseHoverDps === null ? 'null' : m.noiseHoverDps.toFixed(1)) + '/' +
          (m.noiseFullDps === null ? 'null' : m.noiseFullDps.toFixed(1)) +
          ' | sat ' + (m.motorSatPct === null ? 'null' : m.motorSatPct.toFixed(1)) + '%' +
          ' | latency ' + (m.latencyMs === null ? 'null' : m.latencyMs.toFixed(1)) +
          ' | hasGyro ' + m.hasGyro + ' hasSp ' + m.hasSetpoint + ' hasMotors ' + m.hasMotors,
      )
      console.log(
        '      flight ' + m.flight.flightPct.toFixed(0) + '% | ground ' + m.flight.groundPct.toFixed(0) +
        '% | crashPins ' + m.flight.crashPinPct.toFixed(0) + '% | excluded сегментов: ' + m.excluded.length +
        ' (' + m.excluded.filter((s) => s.kind === 'crash').length + ' crash)',
      )
    } catch (e) {
      console.log('  [' + i + '] PARSE ERROR: ' + (e as Error).message)
    }
  }
  console.log('  --- чистых завершений: ' + cleanEnds + '/' + nLogs + ', всего фреймов ' + totalFrames.toLocaleString('ru-RU'))
}
}

main()
