// Просмотр трасс загруженного blackbox-лога: гироскоп, сетпоинт, моторы, газ, напряжение.
// Исключённые из анализа участки (земля/посадка, пины моторов) подсвечены заливкой.
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
} from 'recharts'
import { AreaChart as AreaChartIcon } from 'lucide-react'
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

export default function LogCharts(props: { log: ParsedLog; metrics: LogMetrics }) {
  const { log, metrics } = props
  const [active, setActive] = useState({ gyro: true, sp: true, motors: false, thr: false, vbat: false })

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

    if (thrSp) out.push({ id: 'thr', label: 'Газ (миксер)', unit: '', traces: [{ name: 'throttle', color: 'hsl(140 70% 50%)', arr: thrSp }] })
    else if (thrRc) out.push({ id: 'thr', label: 'Газ (rcCommand)', unit: 'мкс', traces: [{ name: 'throttle', color: 'hsl(140 70% 50%)', arr: thrRc }] })

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
            (стоянка на столе/посадка, пины моторов при столкновении).
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
        .map((g) => (
          <div key={g.id} className="rounded-md border p-3">
            <div className="text-sm font-medium mb-2">
              {g.label}
              {g.unit && <span className="text-xs text-muted-foreground">, {g.unit}</span>}
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartFor(g)} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 11 }}
                    unit=" с"
                    stroke={TICK}
                    domain={[0, Math.max(durationSec, 0.1)]}
                    type="number"
                  />
                  <YAxis tick={{ fontSize: 11 }} stroke={TICK} />
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
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
    </div>
  )
}
