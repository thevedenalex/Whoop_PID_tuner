import { useMemo, useState } from 'react'
import LogDrop, { type LoadedLog } from '@/components/LogDrop'
import LogInfoBar from '@/components/LogInfoBar'
import RatesPanel, { clampAxisRates, DEFAULT_RATES, type AxisRates, type RatesState } from '@/components/RatesPanel'
import SettingsIO from '@/components/SettingsIO'
import BuildPanel, { computeBuild } from '@/components/BuildPanel'
import ResultsPanel from '@/components/ResultsPanel'
import { computeTune } from '@/lib/tune/engine'
import type { SharpnessProfile } from '@/lib/tune/engine'
import { parseBbl } from '@/lib/bbl/parser'
import { extractLogSettings } from '@/lib/bbl/settings'
import { analyzeLog } from '@/lib/analyze/metrics'
import { DEFAULT_SELECTION } from '@/lib/tune/catalog'
import type { ParsedLog } from '@/lib/bbl/types'
import type { LogMetrics } from '@/lib/analyze/metrics'

function prefillRatesFromLog(log: ParsedLog | null): { rates: RatesState; fromLog: boolean } {
  if (!log) return { rates: DEFAULT_RATES, fromLog: false }
  const parseArr = (name: string): number[] | null => {
    const s = log.headers[name]
    if (!s) return null
    const arr = s.split(',').map((x) => parseFloat(x.trim()))
    return arr.length > 0 && arr.every((x) => !isNaN(x)) ? arr : null
  }
  // Betaflight хранит Actual-рейты так: rc_rates = центр/10 (°/с), rates = макс/10 (°/с), rc_expo = экспо %
  const rcRates = parseArr('rc_rates')
  const ratesArr = parseArr('rates')
  const rcExpo = parseArr('rc_expo')
  const ratesType = parseInt(log.headers['rates_type'] || '0', 10)
  const mk = (i: number): AxisRates => {
    const expo = rcExpo && !isNaN(rcExpo[i] ?? NaN) ? rcExpo[i] : DEFAULT_RATES.roll.expo
    if (ratesType === 3 && rcRates && ratesArr && !isNaN(rcRates[i] ?? NaN) && !isNaN(ratesArr[i] ?? NaN)) {
      return clampAxisRates({ center: rcRates[i] * 10, max: ratesArr[i] * 10, expo })
    }
    // Прочие типы рейтов: грубая оценка максимума из rcRate, центр — доля от него
    const fallback = DEFAULT_RATES.roll
    const max =
      rcRates && !isNaN(rcRates[i] ?? NaN)
        ? Math.max(200, Math.min(1600, Math.round(rcRates[i] * 716)))
        : fallback.max
    return clampAxisRates({ center: Math.round(max * 0.45), max, expo })
  }
  return { rates: { roll: mk(0), pitch: mk(1), yaw: mk(2) }, fromLog: true }
}

export default function Home() {
  const [loaded, setLoaded] = useState(null as LoadedLog | null)
  const [rates, setRates] = useState(DEFAULT_RATES)
  const [fromLog, setFromLog] = useState(false)
  const [build, setBuild] = useState(() => computeBuild(DEFAULT_SELECTION, 0))
  const [switching, setSwitching] = useState(false)
  const [logError, setLogError] = useState(null as string | null)
  const [profile, setProfile] = useState('race' as SharpnessProfile)

  const handleLoaded = (l: LoadedLog) => {
    setLoaded(l)
    setLogError(null)
    const pre = prefillRatesFromLog(l.log)
    setRates(pre.rates)
    setFromLog(pre.fromLog)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSelectLog = async (index: number) => {
    if (!loaded || index === loaded.log.logIndex || switching) return
    setSwitching(true)
    setLogError(null)
    try {
      const log = await parseBbl(loaded.buf, index)
      const metrics = analyzeLog(log)
      const pre = prefillRatesFromLog(log)
      setLoaded({ ...loaded, log, metrics })
      setRates(pre.rates)
      setFromLog(pre.fromLog)
    } catch (e) {
      setLogError(e instanceof Error ? e.message : String(e))
    } finally {
      setSwitching(false)
    }
  }

  // фактические PID/фильтры, на которых был записан лог (из H-заголовков)
  const logSettings = useMemo(
    () => (loaded ? extractLogSettings(loaded.log.headers) : null),
    [loaded],
  )

  const tune = useMemo(() => {
    return computeTune({
      frameClass: build.frameClass,
      auw: build.auw,
      motorKv: build.motorKv,
      rates: { roll: rates.roll.max, pitch: rates.pitch.max, yaw: rates.yaw.max },
      expo: (rates.roll.expo + rates.pitch.expo + rates.yaw.expo) / 300,
      metrics: loaded?.metrics ?? null,
      hasLog: loaded !== null,
      influences: build.influences,
      profile,
      logSettings,
    })
  }, [build, rates, loaded, profile, logSettings])

  const log: ParsedLog | null = loaded?.log ?? null
  const metrics: LogMetrics | null = loaded?.metrics ?? null

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <img
            src="icon.webp"
            alt="TinyWhoop PID Tuner"
            className="shrink-0 w-10 h-10 rounded-xl border border-primary/30 shadow-[0_0_18px_hsl(270_90%_66%/0.35)]"
          />
          <div>
            <h1 className="font-display text-xl font-bold tracking-wide">
              TinyWhoop PID Tuner
            </h1>
            <p className="text-xs text-muted-foreground">
              Анализ Blackbox-логов и гоночный тюн PID для 65–75 мм вупов · Betaflight 4.4–4.5
            </p>
          </div>
          <div className="flex-1" />
          <SettingsIO
            rates={rates}
            build={build}
            profile={profile}
            onRates={(r) => {
              setRates(r)
              setFromLog(false)
            }}
            onProfile={setProfile}
            onBuild={setBuild}
          />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        <LogDrop onLoaded={handleLoaded} />

        <LogInfoBar
          log={log}
          fileName={loaded?.fileName ?? null}
          sizes={loaded?.sizes ?? null}
          switching={switching}
          error={logError}
          onSelectLog={(i) => void handleSelectLog(i)}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <RatesPanel rates={rates} onChange={setRates} fromLog={fromLog} profile={profile} onProfile={setProfile} />
          <BuildPanel build={build} onChange={setBuild} />
        </div>

        <div>
          <ResultsPanel tune={tune} metrics={metrics} hasLog={loaded !== null} log={log} logSettings={logSettings} />
        </div>

        <footer className="border-t pt-4 pb-8 text-xs text-muted-foreground space-y-1">
          <p>
            Рекомендации — стартовая точка для гоночного стиля (быстрые стопы, резкая реакция на
            стики). Летайте, смотрите blackbox, итерируйте: PID-таблица → CLI → проверка логом.
          </p>
          <p>
            Расчёт выполняется локально в браузере. Декодер совместим с форматом Blackbox Data
            Version 2 (Betaflight 4.x).
          </p>
        </footer>
      </main>
    </div>
  )
}
