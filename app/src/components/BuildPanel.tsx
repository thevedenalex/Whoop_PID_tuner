import { useState } from 'react'
import { Wrench, Scale } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CATEGORIES, getComponent } from '@/lib/tune/catalog'
import type { Category, FrameClass, Component, InfluenceRule } from '@/lib/tune/catalog'

export interface BuildInfo {
  selection: { [cat: string]: string }
  extraWeight: number
  auw: number
  frameClass: FrameClass
  motorKv: number | null
  influences: InfluenceRule[]
}

export function computeBuild(selection: { [cat: string]: string }, extraWeight: number): BuildInfo {
  let auw = extraWeight
  let frameClass: FrameClass = '65'
  let motorKv: number | null = null
  const influences: InfluenceRule[] = []
  for (const cat of CATEGORIES) {
    const comp = getComponent(cat.id, selection[cat.id])
    if (!comp) continue
    auw += comp.weight
    if (cat.id === 'frame' && comp.cls) frameClass = comp.cls
    if (cat.id === 'motor') motorKv = comp.kv ?? null

    // влияние компонента на настройки (не только вес)
    if (cat.id === 'motor' && comp.bearing === 'ball') {
      influences.push({
        target: 'dAdj',
        value: 1,
        desc: 'D +1',
        reason: comp.name + ': шариковые подшипники — меньше механического шума и люфтов, можно чуть больше D',
      })
    }
    if (cat.id === 'prop' && comp.blades === 4) {
      influences.push({
        target: 'dAdj',
        value: -1,
        desc: 'D −1, фильтры ↑',
        reason: comp.name + ': 4 лопасти — больше тяги, но выше нагрузка и шум: фильтруем сильнее, D чуть ниже от нагрева',
      })
      influences.push({ target: 'lpf2Delta', value: -30, desc: '', reason: '' })
      influences.push({ target: 'dynNotchMin', value: 4, desc: '', reason: '' })
    }
    if (cat.id === 'prop' && comp.blades === 2) {
      influences.push({
        target: 'dAdj',
        value: 1,
        desc: 'D +1, фильтры ↓',
        reason: comp.name + ': 2 лопасти — лёгкая нагрузка и чистый сигнал: ослабляем фильтры ради задержки, D чуть выше для резких стопов',
      })
      influences.push({ target: 'lpf2Delta', value: 20, desc: '', reason: '' })
    }
    if (cat.id === 'prop' && comp.aggr === 'aggressive') {
      influences.push({
        target: 'dAdj',
        value: 1,
        desc: 'D +1, фильтры ↑',
        reason: comp.name + ': агрессивный шаг — много тяги, но больше шума и пропвоша: добавляем D и чуть фильтруем сильнее',
      })
      influences.push({ target: 'lpf2Delta', value: -10, desc: '', reason: '' })
    }
    if (cat.id === 'prop' && comp.aggr === 'light') {
      influences.push({
        target: 'pAdj',
        value: 1,
        desc: 'P +1',
        reason: comp.name + ': лёгкие пропы дают меньше тяги — добавляем P, чтобы сохранить резкость на стиках',
      })
      influences.push({ target: 'lpf2Delta', value: 10, desc: '', reason: '' })
    }
    if (cat.id === 'fc' && comp.gyro === 'mpu6000') {
      influences.push({
        target: 'lpf2Delta',
        value: 20,
        desc: 'gyro_lpf2 +20',
        reason: comp.name + ': MPU6000 — самый «тихий» гироскоп, ослабляем gyro LPF ради минимальной задержки',
      })
    }
    if (cat.id === 'fc' && comp.gyro === 'icm42688') {
      influences.push({
        target: 'lpf2Cap',
        value: 280,
        desc: 'gyro_lpf2 ≤280',
        reason: comp.name + ': ICM-42688-P шумноват на низких частотах — ограничиваем gyro LPF',
      })
    }
    if (cat.id === 'fc' && comp.gyro === 'bmi270') {
      influences.push({
        target: 'lpf2Cap',
        value: 290,
        desc: 'gyro_lpf2 ≤290',
        reason: comp.name + ': BMI270 требует чуть большей фильтрации гироскопа',
      })
    }
  }
  return { selection, extraWeight, auw, frameClass, motorKv, influences }
}

export default function BuildPanel(props: {
  build: BuildInfo
  onChange: (b: BuildInfo) => void
}) {
  const { build, onChange } = props
  const [extraDraft, setExtraDraft] = useState(null as string | null)

  const setSel = (cat: string, id: string) => {
    onChange(computeBuild({ ...build.selection, [cat]: id }, build.extraWeight))
  }

  const ref = build.frameClass === '75' ? 34 : 26
  const delta = build.auw - ref

  // группировка позиций: рамы — по размеру, моторы — по типоразмеру,
  // пропы — по размеру, остальные — по питанию.
  // Внутри группы — сортировка по производителю (алфавит), безымянные (generic) — в конец.
  const BRAND_RE = /^(BetaFPV|Happymodel|NBD|RCinPower|VCI|Gemfan|HQProp|RunCam|Caddx|Foxeer|HDZero|ELRS|TBS|Tattu|Dogcom)\b/
  const brandOf = (x: Component) => x.name.match(BRAND_RE)?.[1] ?? null
  const byName = (a: Component, b: Component) => {
    const ba = brandOf(a)
    const bb = brandOf(b)
    if (ba && bb && ba !== bb) return ba.localeCompare(bb, undefined, { numeric: true })
    if (ba && !bb) return -1
    if (!ba && bb) return 1
    const cellsRank = (c?: string) => (c === '1S' ? 0 : c === '2S' ? 1 : 2)
    return cellsRank(a.cells) - cellsRank(b.cells) || a.name.localeCompare(b.name, undefined, { numeric: true })
  }
  const groupsFor = (catId: Category, items: Component[]) => {
    const groups: { label: string; items: Component[] }[] = []
    if (catId === 'frame') {
      for (const cls of ['65', '75'] as FrameClass[]) {
        const g = items.filter((x) => x.cls === cls).sort(byName)
        if (g.length) groups.push({ label: 'Рамы ' + cls + ' мм', items: g })
      }
      return groups
    }
    if (catId === 'motor') {
      const sizeOf = (x: Component) => x.name.match(/\d{4}(?:\.\d)?/)?.[0] ?? 'прочие'
      const sizes = Array.from(new Set(items.map(sizeOf))).sort()
      for (const s of sizes) {
        const g = items.filter((x) => sizeOf(x) === s).sort(byName)
        groups.push({ label: s === 'прочие' ? 'Прочие' : 'Моторы ' + s, items: g })
      }
      return groups
    }
    if (catId === 'prop') {
      const re31 = /31мм|31MM/i
      const re40 = /40мм|40MM/i
      const g31 = items.filter((x) => re31.test(x.name)).sort((a, b) => (a.blades ?? 0) - (b.blades ?? 0) || byName(a, b))
      const g40 = items.filter((x) => re40.test(x.name)).sort((a, b) => (a.blades ?? 0) - (b.blades ?? 0) || byName(a, b))
      if (g31.length) groups.push({ label: 'Пропы 31 мм', items: g31 })
      if (g40.length) groups.push({ label: 'Пропы 40 мм', items: g40 })
      const rest = items.filter((x) => !re31.test(x.name) && !re40.test(x.name)).sort(byName)
      if (rest.length) groups.push({ label: 'Прочие', items: rest })
      return groups
    }
    const s1 = items.filter((x) => x.cells === '1S').sort(byName)
    const s2 = items.filter((x) => x.cells === '2S').sort(byName)
    const rest = items.filter((x) => !x.cells).sort(byName)
    if (s1.length) groups.push({ label: '1S', items: s1 })
    if (s2.length) groups.push({ label: '2S', items: s2 })
    if (rest.length) groups.push({ label: groups.length ? 'Универсальные' : '', items: rest })
    return groups
  }

  const itemLabel = (catId: Category, item: Component) => {
    let s = item.name + ' · ' + item.weight.toFixed(1) + ' г'
    if (catId === 'motor' && item.cells) s += ' · ' + item.cells
    return s
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="w-4 h-4 text-primary" />
          Шаг 3. Сборка и вес
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="space-y-1.5 min-w-0">
              <Label className="text-xs text-muted-foreground">
                {cat.title}
              </Label>
              <Select value={build.selection[cat.id]} onValueChange={(v) => setSel(cat.id, v)}>
                <SelectTrigger className="h-8 w-full max-w-full truncate text-xs">
                  <SelectValue className="truncate" />
                </SelectTrigger>
                <SelectContent>
                  {groupsFor(cat.id, cat.items).map((g) =>
                    g.label ? (
                      <SelectGroup key={g.label}>
                        <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {g.label}
                        </SelectLabel>
                        {g.items.map((item) => (
                          <SelectItem key={item.id} value={item.id} className="text-xs">
                            {itemLabel(cat.id, item)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : (
                      g.items.map((item) => (
                        <SelectItem key={item.id} value={item.id} className="text-xs">
                          {itemLabel(cat.id, item)}
                        </SelectItem>
                      ))
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Прочее (кабели, бампер, облегчение −), г</Label>
            <Input
              type="number"
              min={-10}
              max={20}
              step={0.5}
              value={extraDraft !== null ? extraDraft : String(build.extraWeight)}
              onFocus={() => setExtraDraft(String(build.extraWeight))}
              onChange={(e) => {
                const raw = e.target.value
                setExtraDraft(raw)
                const v = parseFloat(raw)
                if (!isNaN(v)) onChange(computeBuild(build.selection, Math.max(-10, Math.min(20, v))))
              }}
              onBlur={() => setExtraDraft(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              className="h-8 text-xs font-mono-data"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2.5">
          <Scale className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Взлётный вес (AUW)</div>
            <div className="text-lg font-mono-data font-semibold">
              {build.auw.toFixed(1)} г
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">референс {build.frameClass} мм</div>
            <div className={`text-sm font-mono-data ${Math.abs(delta) >= 4 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {delta >= 0 ? '+' : ''}
              {delta.toFixed(1)} г
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Веса компонентов ориентировочные (по спецификациям производителей). Тюн корректируется от
          отклонения AUW от референса класса.
        </p>
      </CardContent>
    </Card>
  )
}
