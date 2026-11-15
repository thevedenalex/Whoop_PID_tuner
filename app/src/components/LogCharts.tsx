// Просмотр трасс загруженного blackbox-лога: гироскоп, сетпоинт, моторы, газ, напряжение.
// Исключённые из анализа участки (земля/посадка, пины моторов) подсвечены заливкой.
// Масштаб по времени: ползунок под графиком — выделите диапазон для приближения,
// тяните окно или края для прокрутки.
import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  Brush,
} from 'recharts'
import { AreaChart as AreaChartIcon, ZoomOut } from 'lucide-react'
import { getVec, getField } from '@/lib/bbl/parser'
import type { ParsedLog, NumArr } from '@/lib/bbl/types'
import type { LogMetrics } from '@/lib/analyze/metrics'
import { Button } from '@/components/ui/button'

const AXIS_COLORS = ['hsl(270 90% 66%)', 'hsl(45 90% 55%)', 'hsl(210 80% 62%)']
const AXIS_NAMES = ['roll', 'pitch', 'yaw']
const MOTOR_COLORS = ['hsl(140 70% 50%)', 'hsl(200 85% 55%)', 'hsl(25 90% 55%)', 'hsl(330 75% 60%)']
const GRID = 'hsl(210 18% 14%)'
const TICK = 'hsl(200 10% 55%)'

interface Trace {
  name: string
  color: string
  arr: NumArr
}

interface TraceGroup {
  id: string
  label: string
  unit: string
  traces: Trace[]
}

const MAX_POINTS = 1200

// Газ в процентах. Шкалы в логах: setpoint[3] Betaflight 0..1; rcCommand[3] — мкс
// (1000..2000); встречается и 0..1000. Отличаем по размаху первых кадров:
// мкс не опускаются ниже ~900, шкала 0..1000 — почти до нуля на земле.
function throttlePct(arr: NumArr): NumArr {
  let max = 0
  let min = Infinity
  const n = Math.min(arr.length, 300)
  for (let i = 0; i < n; i++) {
    if (arr[i] > max) max = arr[i]
    if (arr[i] < min) min = arr[i]
  }
  const out = new Float64Array(arr.length)
  if (max <= 1.5) for (let i = 0; i < arr.length; i++) out[i] = arr[i] * 100
  else if (min < 900) for (let i = 0; i < arr.length; i++) out[i] = arr[i] / 10
  else for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - 1000) / 10
  return out as unknown as NumArr
}

export default function LogCharts(props: { log: ParsedLog; metrics: LogMetrics }) {
  const { log, metrics } = props
  const [active, setActive] = useState({ gyro: true, sp: true, motors: false, thr: false, vbat: false })
  // диапазон видимого окна по индексам ресемплированных строк (для зума/скролла)
  const [ranges, setRanges] = useState({} as { [groupId: string]: [number, number] })

  const time = getField(log, 'time')
  const groups = useMemo(() => {
    if (!time) return []
    const out: TraceGroup[] = []
    const gyro = getVec(log, 'gyroADC', 3)
    const spMain = getVec(log, 'setpoint', 3)
    const spFallback = getVec(log, 'rcCommand', 3)
    const motors = getVec(log, 'motor', log.motorCount || 4)
    const thrSp = getField(log, 'setpoint[3]')
    const thrRc = getField(log, 'rcCommand[3]')
    const vbat = getField(log, 'vbatLatest')

    const gyroTr: Trace[] = []
    for (let a = 0; a < 3; a++) if (gyro[a]) gyroTr.push({ name: AXIS_NAMES[a], color: AXIS_COLORS[a], arr: gyro[a] as NumArr })
    if (gyroTr.length) out.push({ id: 'gyro', label: 'Гироскоп', unit: '°/с', traces: gyroTr })

    const useFallback = !spMain.every((x) => x !== null) && spFallback.every((x) => x !== null)
    const spSrc = useFallback ? spFallback : spMain
    const spTr: Trace[] = []
    for (let a = 0; a < 3; a++) if (spSrc[a]) spTr.push({ name: AXIS_NAMES[a], color: AXIS_COLORS[a], arr: spSrc[a] as NumArr })
    if (spTr.length) {
      out.push({
        id: 'sp',
        label: useFallback ? 'Сетпоинт (rcCommand)' : 'Сетпоинт',
        unit: '°/с',
        traces: spTr,
      })
    }

    const motTr: Trace[] = []
    for (let m = 0; m < motors.length; m++) {
      if (motors[m]) motTr.push({ name: 'M' + (m + 1), color: MOTOR_COLORS[m % 4], arr: motors[m] as NumArr })
    }
    if (motTr.length) out.push({ id: 'motors', label: 'Моторы', unit: 'мкс', traces: motTr })

    if (thrSp) out.push({ id: 'thr', label: 'Газ (миксер)', unit: '%', traces: [{ name: 'throttle', color: 'hsl(140 70% 50%)', arr: throttlePct(thrSp) }] })
    else if (thrRc) out.push({ id: 'thr', label: 'Газ (rcCommand)', unit: '%', traces: [{ name: 'throttle', color: 'hsl(140 70% 50%)', arr: throttlePct(thrRc) }] })

    if (vbat) out.push({ id: 'vbat', label: 'Напряжение', unit: 'В', traces: [{ name: 'vbat', color: 'hsl(55 90% 55%)', arr: vbat }] })
    return out
  }, [log, time])

  const t0 = time ? time[0] : 0
  const durationSec = log.durationMs / 1000

  const chartFor = (g: TraceGroup) => {
    const n = time ? time.length : 0
    const stride = Math.max(1, Math.ceil(n / MAX_POINTS))
    const rows: { [k: string]: number }[] = []
    for (let i = 0; i < n; i += stride) {
      const row: { [k: string]: number } = { t: Math.round(((time as NumArr)[i] - t0) / 100) / 10000 }
      for (const tr of g.traces) row[tr.name] = Math.round(tr.arr[i] * 100) / 100
      rows.push(row)
    }
    return rows
  }

  const excluded = metrics.excluded || []
  const nGround = excluded.filter((s) => s.kind === 'ground').length
  const nCrash = excluded.filter((s) => s.kind === 'crash').length

  if (!time || groups.length === 0) {
    return <p className="text-sm text-muted-foreground">В логе нет временной оси — графики недоступны.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 flex-wrap">
        <AreaChartIcon className="w-4 h-4 text-primary mt-1.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">
            Осциллограммы по всему логу. Серые и красные зоны — участки, исключённые из анализа
            (стоянка на столе/посадка, пины моторов при столкновении). Для приближения выделите
            диапазон ползунком под графиком, окно можно таскать и растягивать.
          </p>
          <div className="flex gap-1 flex-wrap">
            {groups.map((g) => (
              <Button
                key={g.id}
                size="sm"
                variant={active[g.id as 'gyro'] ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setActive({ ...active, [g.id]: !active[g.id as 'gyro'] })}
              >
                {g.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'hsl(210 15% 45%)', opacity: 0.45 }} />
              земля/посадка ({nGround})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'hsl(0 80% 55%)', opacity: 0.45 }} />
              пины/столкновение ({nCrash})
            </span>
          </div>
        </div>
      </div>

      {groups
        .filter((g) => active[g.id as 'gyro'])
        .map((g) => {
          const all = chartFor(g)
          const full: [number, number] = [0, all.length - 1]
          const range = ranges[g.id] ?? full
          const zoomed = range[0] > full[0] || range[1] < full[1]
          const visible = zoomed ? all.slice(range[0], range[1] + 1) : all
          const tMin = visible.length ? visible[0].t : 0
          const tMax = visible.length ? visible[visible.length - 1].t : durationSec
          return (
            <div key={g.id} className="rounded-md border p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-sm font-medium">
                  {g.label}
                  {g.unit && <span className="text-xs text-muted-foreground">, {g.unit}</span>}
                </div>
                {zoomed && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] gap-1 ml-auto"
                    onClick={() => setRanges({ ...ranges, [g.id]: full })}
                  >
                    <ZoomOut className="w-3 h-3" />
                    Весь лог ({tMin.toFixed(1)}–{tMax.toFixed(1)} с)
                  </Button>
                )}
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={visible} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                    <XAxis
                      dataKey="t"
                      tick={{ fontSize: 11 }}
                      unit=" с"
                      stroke={TICK}
                      domain={['dataMin', 'dataMax']}
                      type="number"
                    />
                    <YAxis tick={{ fontSize: 11 }} stroke={TICK} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(210 28% 8%)', border: '1px solid hsl(210 18% 18%)', fontSize: 12 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {excluded.map((s, i) => (
                      <ReferenceArea
                        key={i}
                        x1={s.fromMs / 1000}
                        x2={s.toMs / 1000}
                        fill={s.kind === 'crash' ? 'hsl(0 80% 55%)' : 'hsl(210 15% 45%)'}
                        fillOpacity={0.18}
                        stroke="none"
                      />
                    ))}
                    {g.traces.map((tr) => (
                      <Line
                        key={tr.name}
                        type="monotone"
                        dataKey={tr.name}
                        stroke={tr.color}
                        dot={false}
                        strokeWidth={1.3}
                        isAnimationActive={false}
                      />
                    ))}
                    <Brush
                      dataKey="t"
                      data={all}
                      startIndex={range[0]}
                      endIndex={range[1]}
                      height={20}
                      stroke="hsl(270 90% 66%)"
                      travellerWidth={8}
                      onChange={(e) => {
                        const s = e.startIndex ?? 0
                        const en = e.endIndex ?? all.length - 1
                        if (s !== range[0] || en !== range[1]) setRanges({ ...ranges, [g.id]: [s, en] })
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )
        })}
    </div>
  )
}
