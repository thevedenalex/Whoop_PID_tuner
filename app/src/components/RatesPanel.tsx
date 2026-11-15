import { useState } from 'react'
import { Gauge } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SharpnessProfile } from '@/lib/tune/engine'

// Рейты в формате Betaflight «Actual»: центральная чувствительность (°/с у центра стика),
// максимальный рейт (°/с на полном стике), экспонента (0–100 %).
// Кривая: rate(x) = x·center + (max − center)·|x|·(x⁵·e + x·(1−e)), e = expo/100.
export interface AxisRates {
  center: number
  max: number
  expo: number // 0..100 %
}

export interface RatesState {
  roll: AxisRates
  pitch: AxisRates
  yaw: AxisRates
}

export const RATE_LIMITS = { centerMin: 50, centerMax: 600, maxMin: 200, maxMax: 2000, expoMax: 80 }

export const DEFAULT_RATES: RatesState = {
  roll: { center: 330, max: 720, expo: 15 },
  pitch: { center: 330, max: 720, expo: 15 },
  yaw: { center: 260, max: 560, expo: 15 },
}

// Приводит ось к корректному виду: center ≤ max, всё в пределах лимитов.
export function clampAxisRates(a: AxisRates): AxisRates {
  const center = Math.max(RATE_LIMITS.centerMin, Math.min(RATE_LIMITS.centerMax, Math.round(a.center)))
  const max = Math.max(RATE_LIMITS.maxMin, Math.min(RATE_LIMITS.maxMax, Math.round(a.max)))
  const expo = Math.max(0, Math.min(RATE_LIMITS.expoMax, Math.round(a.expo)))
  return center <= max ? { center, max, expo } : { center: max, max, expo }
}

// Свободно редактируемое числовое поле: пока идёт ввод, показываем черновик без
// клампа (можно очистить и набрать с нуля), ограничения применяем к значению.
function RateInput(props: {
  value: number
  onCommit: (v: number) => void
  className?: string
}) {
  const [draft, setDraft] = useState(null as string | null)
  const shown = draft !== null ? draft : String(props.value)
  return (
    <Input
      type="number"
      value={shown}
      onFocus={() => setDraft(String(props.value))}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        const v = parseInt(raw, 10)
        if (!isNaN(v)) props.onCommit(v)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      className={props.className}
    />
  )
}

export default function RatesPanel(props: {
  rates: RatesState
  onChange: (r: RatesState) => void
  fromLog: boolean
  profile: SharpnessProfile
  onProfile: (p: SharpnessProfile) => void
}) {
  const { rates, onChange } = props
  type RatesPatch = { roll?: AxisRates; pitch?: AxisRates; yaw?: AxisRates }
  const set = (patch: RatesPatch) => onChange({ ...rates, ...patch })

  const axes = [
    ['roll', 'Крен'],
    ['pitch', 'Тангаж'],
    ['yaw', 'Рысканье'],
  ] as [keyof RatesState, string][]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          Шаг 2. Рейты (Actual), на которых летаете
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Профиль резкости</Label>
          <Select value={props.profile} onValueChange={(v) => props.onProfile(v as SharpnessProfile)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="soft" className="text-xs">
                Мягкий — плавно, без рывков (indoor, тренировка)
              </SelectItem>
              <SelectItem value="race" className="text-xs">
                Гоночный — баланс резкости и стабильности
              </SelectItem>
              <SelectItem value="sharp" className="text-xs">
                Максимум — минимальная задержка, стопы по рельсам
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {axes.map(([key, name]) => {
          const a = rates[key]
          const setAxis = (patch: { center?: number; max?: number; expo?: number }) =>
            set({ [key]: clampAxisRates({ ...a, ...patch }) } as RatesPatch)
          return (
            <div key={key} className="space-y-1.5">
              <div className="text-xs font-medium text-foreground/80">{name}</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1 min-w-0">
                  <Label className="text-[11px] text-muted-foreground">Центр, °/с</Label>
                  <RateInput value={a.center} onCommit={(v) => setAxis({ center: v })} className="h-8 text-xs font-mono-data px-2" />
                </div>
                <div className="space-y-1 min-w-0">
                  <Label className="text-[11px] text-muted-foreground">Макс, °/с</Label>
                  <RateInput value={a.max} onCommit={(v) => setAxis({ max: v })} className="h-8 text-xs font-mono-data px-2" />
                </div>
                <div className="space-y-1 min-w-0">
                  <Label className="text-[11px] text-muted-foreground">Экспо, %</Label>
                  <RateInput value={a.expo} onCommit={(v) => setAxis({ expo: v })} className="h-8 text-xs font-mono-data px-2" />
                </div>
              </div>
            </div>
          )
        })}
        <p className="text-xs text-muted-foreground">
          Гоночный ориентир (Actual): центр 200–360°/с, макс 700–900°/с, экспо 10–25%.
          {props.fromLog ? ' Значения предзаполнены из лога.' : ''}
        </p>
      </CardContent>
    </Card>
  )
}
