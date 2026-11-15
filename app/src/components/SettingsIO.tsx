import { useRef } from 'react'
import { Save, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CATEGORIES, DEFAULT_SELECTION } from '@/lib/tune/catalog'
import { computeBuild, type BuildInfo } from './BuildPanel'
import { clampAxisRates, DEFAULT_RATES, type RatesState } from './RatesPanel'
import type { SharpnessProfile } from '@/lib/tune/engine'

function isNum(x: unknown): boolean {
  return typeof x === 'number' && isFinite(x)
}

export interface ParsedSettings {
  rates: RatesState
  selection: { [k: string]: string }
  extraWeight: number
  profile: SharpnessProfile
}

// Разбирает и валидирует файл настроек: рейты (только валидные оси), сборка
// (только известные категории и существующие позиции), «прочее», г.
export function parseSettings(raw: string): { ok: true; data: ParsedSettings } | { ok: false; error: string } {
  let obj: { [k: string]: unknown }
  try {
    obj = JSON.parse(raw) as { [k: string]: unknown }
  } catch {
    return { ok: false, error: 'файл не является корректным JSON' }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'пустой файл настроек' }

  const rates = { ...DEFAULT_RATES }
  const r = obj['rates'] as { [k: string]: unknown } | undefined
  if (r && typeof r === 'object') {
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const a = r[axis] as { [k: string]: unknown } | undefined
      if (a && typeof a === 'object' && isNum(a['center']) && isNum(a['max']) && isNum(a['expo'])) {
        rates[axis] = clampAxisRates({
          center: a['center'] as number,
          max: a['max'] as number,
          expo: a['expo'] as number,
        })
      }
    }
  }

  const selection = { ...DEFAULT_SELECTION }
  let extraWeight = 0
  const b = obj['build'] as { [k: string]: unknown } | undefined
  if (b && typeof b === 'object') {
    const sel = b['selection'] as { [k: string]: unknown } | undefined
    if (sel && typeof sel === 'object') {
      for (const cat of CATEGORIES) {
        const v = sel[cat.id]
        if (typeof v === 'string' && cat.items.some((it) => it.id === v)) selection[cat.id] = v
      }
    }
    if (isNum(b['extraWeight'])) extraWeight = Math.max(-10, Math.min(20, b['extraWeight'] as number))
  }

  let profile: SharpnessProfile = 'race'
  const p = obj['profile']
  if (p === 'soft' || p === 'race' || p === 'sharp') profile = p

  return { ok: true, data: { rates, selection, extraWeight, profile } }
}

export default function SettingsIO(props: {
  rates: RatesState
  build: BuildInfo
  profile: SharpnessProfile
  onRates: (r: RatesState) => void
  onBuild: (b: BuildInfo) => void
  onProfile: (p: SharpnessProfile) => void
}) {
  const fileRef = useRef(null as HTMLInputElement | null)

  const save = () => {
    const data = {
      app: 'tinywhoop-pid-lab',
      version: 1,
      savedAt: new Date().toISOString(),
      rates: props.rates,
      profile: props.profile,
      build: { selection: props.build.selection, extraWeight: props.build.extraWeight },
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'twpl-settings.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Настройки сохранены в файл')
  }

  const load = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = parseSettings(String(reader.result))
      if (!res.ok) {
        toast.error('Не удалось загрузить: ' + res.error)
        return
      }
      props.onRates(res.data.rates)
      props.onProfile(res.data.profile)
      props.onBuild(computeBuild(res.data.selection, res.data.extraWeight))
      toast.success('Настройки загружены из файла')
    }
    reader.onerror = () => toast.error('Не удалось прочитать файл')
    reader.readAsText(file)
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={save} title="Сохранить рейты и сборку в файл">
        <Save className="w-4 h-4 mr-1.5" />
        Сохранить
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileRef.current?.click()}
        title="Загрузить рейты и сборку из файла"
      >
        <FolderOpen className="w-4 h-4 mr-1.5" />
        Загрузить
      </Button>
      <input
        ref={(el) => {
          fileRef.current = el
        }}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) load(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
