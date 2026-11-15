import { useMemo, useState } from 'react'
import { Copy, CheckCircle2, AlertTriangle, Activity, TerminalSquare, Info, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { TuneResult } from '@/lib/tune/engine'
import type { LogMetrics } from '@/lib/analyze/metrics'
import type { LogSettings } from '@/lib/bbl/settings'
import type { ParsedLog } from '@/lib/bbl/types'
import { AXIS } from '@/lib/bbl/types'
import LogCharts from '@/components/LogCharts'

function fmt(v: number | null, suffix = '', digits = 0): string {
  if (v === null || v === undefined) return '—'
  return v.toFixed(digits) + suffix
}

function StatCard(props: { title: string; value: string; ok?: boolean | null; hint?: string }) {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{props.title}</div>
      <div
        className={`text-lg font-mono-data font-semibold ${
          props.ok === true ? 'text-emerald-400' : props.ok === false ? 'text-amber-400' : ''
        }`}
      >
        {props.value}
      </div>
      {props.hint && <div className="text-[11px] text-muted-foreground">{props.hint}</div>}
    </div>
  )
}

export default function ResultsPanel(props: {
  tune: TuneResult
  metrics: LogMetrics | null
  hasLog: boolean
  log: ParsedLog | null
  logSettings: LogSettings | null
}) {
  const { tune, metrics, hasLog, log, logSettings } = props
  const [copied, setCopied] = useState(false)
  const [chartAxis, setChartAxis] = useState(0)
  // ручные правки PID (ключ 'p_roll' и т.д., строка); null — правок нет
  const [pidDraft, setPidDraft] = useState(null as { [key: string]: string } | null)

  type Ax = 'roll' | 'pitch' | 'yaw'
  type Lt = 'p' | 'i' | 'd'
  const pidVal = (ax: Ax, l: Lt): number => {
    if (pidDraft) {
      const v = parseInt(pidDraft[l + '_' + ax] ?? '', 10)
      if (!isNaN(v)) return Math.max(0, Math.min(250, v))
    }
    return tune.pid[ax][l]
  }
  const pidText = (ax: Ax, l: Lt): string =>
    pidDraft && l + '_' + ax in pidDraft ? pidDraft[l + '_' + ax] : String(tune.pid[ax][l])
  const setCell = (ax: Ax, l: Lt, txt: string) => {
    setPidDraft({ ...(pidDraft ?? {}), [l + '_' + ax]: txt.replace(/[^\d]/g, '').slice(0, 3) })
  }
  const pidDirty = pidDraft !== null && Object.values(pidDraft).some((v) => v !== '')

  // CLI с учётом ручных правок PID: заменяем/добавляем set-строки
  const cliLines = useMemo(() => {
    if (!pidDirty) return tune.cli
    const keys = AXIS.flatMap((ax) => (['p', 'i', 'd'] as const).map((l) => `${l}_${ax}`))
    const lines = tune.cli.filter((l) => !keys.some((k) => l.startsWith('set ' + k + ' =')))
    const add = AXIS.flatMap((ax) =>
      (['p', 'i', 'd'] as const).map((l) => `set ${l}_${ax} = ${pidVal(ax as Ax, l)}`)
    )
    const saveIdx = lines.indexOf('save')
    return saveIdx >= 0 ? [...lines.slice(0, saveIdx), ...add, ...lines.slice(saveIdx)] : [...lines, ...add]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pidDraft, pidDirty, tune])

  const chartData = useMemo(() => {
    if (!metrics) return []
    const ev = metrics.steps.find((s) => s.axis === chartAxis)
    if (!ev) return []
    return ev.trace.map((p) => ({ t: p.t, 'Сетпоинт': p.sp, 'Гироскоп': p.gyro }))
  }, [metrics, chartAxis])

  const copyCli = () => {
    void navigator.clipboard.writeText(cliLines.join('\n')).then(() => {
      setCopied(true)
      toast.success('CLI-команды скопированы — вставьте в Betaflight Configurator → CLI')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const score = tune.score

  return (
    <Card className="min-h-[420px]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TerminalSquare className="w-4 h-4 text-primary" />
            Рекомендации по тюну — {tune.frameClass} мм · AUW {tune.auw.toFixed(1)} г
          </CardTitle>
          {score !== null && (
            <Badge
              variant="outline"
              className={`font-mono-data text-sm px-3 py-1 ${
                score >= 80
                  ? 'border-emerald-500/50 text-emerald-400'
                  : score >= 50
                    ? 'border-amber-500/50 text-amber-400'
                    : 'border-red-500/50 text-red-400'
              }`}
            >
              Оценка тюна: {score}/100
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="pid">
          <TabsList className="mb-4 grid h-auto w-full grid-cols-2 gap-[3px] sm:inline-flex sm:h-9 sm:w-fit">
            <TabsTrigger value="pid">PID-таблица</TabsTrigger>
            <TabsTrigger value="analysis">Анализ лога</TabsTrigger>
            <TabsTrigger value="charts" disabled={!hasLog}>
              Графики лога
            </TabsTrigger>
            <TabsTrigger value="cli">CLI diff</TabsTrigger>
            <TabsTrigger value="why">Рекомендации</TabsTrigger>
          </TabsList>

          {/* ---------------- PID table ---------------- */}
          <TabsContent value="pid" className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Значения можно править вручную — изменения попадут в CLI diff.
              </p>
              {pidDirty && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 ml-auto"
                  onClick={() => setPidDraft(null)}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Сбросить к рекомендованным
                </Button>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ось</TableHead>
                  <TableHead className="text-right">P</TableHead>
                  <TableHead className="text-right">I</TableHead>
                  <TableHead className="text-right">D</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {AXIS.map((ax) => (
                  <TableRow key={ax}>
                    <TableCell className="capitalize font-medium">{ax}</TableCell>
                    {(['p', 'i', 'd'] as const).map((l) => (
                      <TableCell key={l} className="text-right">
                        <input
                          className={`w-16 bg-transparent border rounded px-1.5 py-0.5 text-right font-mono-data text-base focus:outline-none focus:border-primary ${
                            pidDirty && l + '_' + ax in (pidDraft ?? {})
                              ? 'border-amber-500/60 text-amber-300'
                              : 'border-border'
                          }`}
                          inputMode="numeric"
                          value={pidText(ax as Ax, l)}
                          onChange={(e) => setCell(ax as Ax, l, e.target.value)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-5 gap-y-2 text-xs">
              {Object.entries(tune.filters).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1 [&:nth-child(2n)]:border-l [&:nth-child(2n)]:pl-3 md:[&:nth-child(3n+1)]:border-l-0 md:[&:nth-child(3n+1)]:pl-0 md:[&:nth-child(3n+2)]:border-l md:[&:nth-child(3n+2)]:pl-3 md:[&:nth-child(3n)]:border-l md:[&:nth-child(3n)]:pl-3">
                  <span className="text-muted-foreground font-mono-data truncate">{k}</span>
                  <span className="font-mono-data shrink-0">{v}</span>
                </div>
              ))}
            </div>
            {!hasLog && (
              <p className="text-xs text-muted-foreground">
                Без лога — это базовый гоночный тюн с поправкой на вес. Загрузите .bbl, чтобы
                скорректировать по фактическому поведению.
              </p>
            )}
          </TabsContent>

          {/* ---------------- Analysis ---------------- */}
          <TabsContent value="analysis" className="space-y-4">
            {!metrics && <p className="text-sm text-muted-foreground">Лог не загружен.</p>}
            {metrics && (
              <>
                {metrics.notes.map((n, i) => (
                  <p key={i} className="text-xs text-amber-400/90 flex gap-1.5 items-start">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {n}
                  </p>
                ))}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <StatCard
                    title="Полёт (в анализе)"
                    value={fmt(metrics.flight.flightPct, '%', 0)}
                    hint={metrics.flight.frames.toLocaleString('ru-RU') + ' фреймов'}
                  />
                  <StatCard
                    title="Земля / посадка"
                    value={fmt(metrics.flight.groundPct, '%', 0)}
                    ok={metrics.flight.groundPct < 5}
                  />
                  <StatCard
                    title="Пины моторов"
                    value={fmt(metrics.flight.crashPinPct, '%', 0)}
                    ok={metrics.flight.crashPinPct === 0}
                  />
                  <StatCard
                    title="Исключено сегментов"
                    value={String(metrics.excluded.length)}
                    ok={metrics.excluded.length === 0}
                    hint="см. вкладку «Графики лога»"
                  />
                </div>

                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Качество отклика и шум
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {AXIS.map((ax, a) => (
                    <div key={ax} className="rounded-md border bg-muted/40 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground capitalize">
                        {ax} · перелёт
                      </div>
                      <div className="font-mono-data text-base">
                        {fmt(metrics.axes[a].overshootPct, '%', 0)}
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          · {metrics.axes[a].events} шагов
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        установление {fmt(metrics.axes[a].settleMs, ' мс')} · задержка{' '}
                        {fmt(metrics.axes[a].delayMs, ' мс')}
                      </div>
                    </div>
                  ))}
                  <StatCard
                    title="Шум в ховере"
                    value={fmt(metrics.noiseHoverDps, ' °/с', 1)}
                    ok={metrics.noiseHoverDps !== null && metrics.noiseHoverDps < 12}
                  />
                  <StatCard
                    title="Шум на газе"
                    value={fmt(metrics.noiseFullDps, ' °/с', 1)}
                    ok={metrics.noiseFullDps !== null && metrics.noiseFullDps < 28}
                    hint={metrics.noiseRatio !== null ? `x${metrics.noiseRatio.toFixed(1)} к ховеру` : undefined}
                  />
                  <StatCard
                    title="Моторы в упор"
                    value={fmt(metrics.motorSatPct, '%', 1)}
                    ok={metrics.motorSatPct === null || metrics.motorSatPct < 3}
                  />
                  <StatCard
                    title="Задержка отклика"
                    value={fmt(metrics.latencyMs, ' мс')}
                    ok={metrics.latencyMs === null || metrics.latencyMs < 25}
                  />
                </div>

                {chartData.length > 0 ? (
                  <div className="rounded-md border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">Шаговый отклик</span>
                      <div className="ml-auto flex gap-1">
                        {AXIS.slice(0, 2).map((ax, a) => (
                          <Button
                            key={ax}
                            size="sm"
                            variant={chartAxis === a ? 'default' : 'outline'}
                            className="h-7 text-xs capitalize"
                            onClick={() => setChartAxis(a)}
                          >
                            {ax}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                          <CartesianGrid stroke="hsl(210 18% 14%)" strokeDasharray="3 3" />
                          <XAxis dataKey="t" tick={{ fontSize: 11 }} unit=" мс" stroke="hsl(200 10% 55%)" />
                          <YAxis tick={{ fontSize: 11 }} unit="°/с" stroke="hsl(200 10% 55%)" />
                          <Tooltip
                            contentStyle={{
                              background: 'hsl(210 28% 8%)',
                              border: '1px solid hsl(210 18% 18%)',
                              fontSize: 12,
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <ReferenceLine x={0} stroke="hsl(210 18% 25%)" />
                          <Line type="stepAfter" dataKey="Сетпоинт" stroke="hsl(270 90% 66%)" dot={false} strokeWidth={2} isAnimationActive={false} />
                          <Line type="monotone" dataKey="Гироскоп" stroke="hsl(45 90% 55%)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Жёлтый догоняет голубой без перелёта и за ≤130 мс — это цель гоночного тюна.
                    </p>
                  </div>
                ) : (
                  hasLog &&
                  metrics.hasGyro && (
                    <p className="text-sm text-muted-foreground">
                      Не найдено чистых ступенек сетпоинта — для анализа отклика летайте резкими
                      щелчками стика (из нейтрали).
                    </p>
                  )
                )}
              </>
            )}
          </TabsContent>

          {/* ---------------- Raw log charts ---------------- */}
          <TabsContent value="charts" className="space-y-4">
            {!log || !metrics ? (
              <p className="text-sm text-muted-foreground">Сначала загрузите .bbl-лог.</p>
            ) : (
              <LogCharts log={log} metrics={metrics} />
            )}
          </TabsContent>

          {/* ---------------- CLI ---------------- */}
          <TabsContent value="cli" className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Вставьте в Betaflight Configurator → вкладка CLI → Enter
              </p>
              <Button size="sm" variant="outline" onClick={copyCli} className="gap-2">
                {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                Копировать
              </Button>
            </div>
            <pre className="scroll-slim overflow-auto rounded-md bg-black/50 border p-4 text-xs font-mono-data leading-relaxed max-h-96">
              {cliLines.join('\n')}
            </pre>
          </TabsContent>

          {/* ---------------- Why ---------------- */}
          <TabsContent value="why" className="space-y-3">
            {logSettings && logSettings.hasPid && (
              <div className="rounded-md border bg-muted/40 px-3 py-3 space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Сейчас в дроне — прочитано из лога
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {AXIS.map((ax) => (
                    <div key={ax} className="rounded border bg-background/50 px-2 py-1.5 text-center">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground capitalize">{ax}</div>
                      <div className="font-mono-data text-sm">
                        {logSettings.pid[ax].p} / {logSettings.pid[ax].i} / {logSettings.pid[ax].d}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground font-mono-data">
                  lpf2 {logSettings.filters['gyro_lpf2_static_hz']} Гц · dyn notch ×{logSettings.filters['dyn_notch_count']}{' '}
                  (Q {(logSettings.filters['dyn_notch_q'] / 100).toFixed(1)},{' '}
                  {logSettings.filters['dyn_notch_min_hz']}–{logSettings.filters['dyn_notch_max_hz']} Гц) · dterm dyn{' '}
                  {logSettings.filters['dterm_lpf1_dyn_min_hz']}–{logSettings.filters['dterm_lpf1_dyn_max_hz']} Гц · TPA{' '}
                  {logSettings.other['tpa_rate']}@{logSettings.other['tpa_breakpoint']} · iterm_relax{' '}
                  {logSettings.other['iterm_relax_cutoff']} Гц · AG {logSettings.other['antigravity_gain']} · FF boost{' '}
                  {logSettings.other['feedforward_boost']}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Ниже — что меняется относительно этих значений. Обновите сборку и рейты, чтобы рекомендации совпали
                  с вашим дроном.
                </p>
              </div>
            )}
            <div className="rounded-md border bg-muted/40 px-3 py-3 space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Оценка задержки фильтров (групповая, по текущим настройкам)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <StatCard
                  title="Задержка гироскопа"
                  value={tune.delay.gyroMs.toFixed(1) + ' мс'}
                  hint={'LPF2 ' + tune.delay.lpf2 + ' Гц + dyn notch ×' + tune.delay.notchCount}
                />
                <StatCard title="Задержка D-term" value={tune.delay.dtermMs.toFixed(1) + ' мс'} hint="динамический + статический PT1" />
                <StatCard
                  title="Итого фильтры"
                  value={tune.delay.totalMs.toFixed(1) + ' мс'}
                  hint={'гоночная база: ' + tune.delay.baseTotalMs.toFixed(1) + ' мс'}
                />
                {tune.delay.logTotalMs !== null && (
                  <StatCard
                    title="Как летал (из лога)"
                    value={tune.delay.logTotalMs.toFixed(1) + ' мс'}
                    hint={
                      'рекомендация: ' +
                      (tune.delay.totalMs - tune.delay.logTotalMs).toFixed(1) +
                      ' мс относительно лога'
                    }
                    ok={tune.delay.totalMs - tune.delay.logTotalMs <= 0}
                  />
                )}
                <StatCard
                  title={tune.delay.deltaMs === 0 ? 'Как у базы' : tune.delay.deltaMs < 0 ? 'Снято вялости' : 'Добавлено'}
                  value={(tune.delay.deltaMs > 0 ? '+' : '') + tune.delay.deltaMs.toFixed(1) + ' мс'}
                  ok={tune.delay.deltaMs <= 0}
                  hint={
                    tune.delay.deltaMs === 0
                      ? 'гоночные настройки фильтров без изменений'
                      : tune.delay.deltaMs < 0
                        ? 'меньше задержки относительно базы'
                        : 'больше задержки ради стабильности'
                  }
                />
                {metrics && metrics.latencyMs !== null && (
                  <StatCard
                    title="Отклик (из лога)"
                    value={metrics.latencyMs.toFixed(0) + ' мс'}
                    ok={metrics.latencyMs < 25}
                  />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Feedforward: boost {tune.other['feedforward_boost']} · transition {tune.other['feedforward_transition']} — опережает
                стик и компенсирует часть задержки. Ощутимая «вялость» = задержка фильтров + отклик из лога; PT1 оценён
                как 1/(2π·f), нотч — на центре диапазона.
              </p>
            </div>
            {tune.explanations.length === 0 && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Info className="w-4 h-4" />
                Корректировок нет — базовый тюн подходит под вашу сборку.
              </p>
            )}
            {tune.explanations.map((e, i) => (
              <div key={i} className="rounded-md border bg-muted/40 px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono-data text-primary">{e.setting}</span>
                  <span className="text-muted-foreground line-through">{e.from}</span>
                  <span>→</span>
                  <span className="font-mono-data">{e.to}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{e.reason}</p>
              </div>
            ))}
            {tune.warnings.map((w, i) => (
              <p key={'w' + i} className="text-xs text-amber-400/90 flex gap-1.5 items-start">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {w}
              </p>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
