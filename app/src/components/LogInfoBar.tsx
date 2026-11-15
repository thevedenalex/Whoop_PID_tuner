import { Loader2 } from 'lucide-react'
import type { ParsedLog } from '@/lib/bbl/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function LogInfoBar(props: {
  log: ParsedLog
  fileName: string
  sizes: number[]
  switching: boolean
  error: string | null
  onSelectLog: (index: number) => void
}) {
  const { log, fileName, sizes, switching, error, onSelectLog } = props
  const h = log.headers
  const fw = [h['Firmware type'], h['Firmware revision']].filter(Boolean).join(' ')
  const craft = h['Craft name'] || '—'
  const items: [string, string][] = [
    ['Файл', fileName],
    ['Прошивка', fw || 'неизвестна'],
    ['Коптер', craft],
    ['Длительность', (log.durationMs / 1000).toFixed(1) + ' с'],
    ['Фреймов', log.frameCount.toLocaleString('ru-RU')],
    ['Частота петли', log.loopHz ? log.loopHz + ' Гц' : '—'],
    ['Моторов', String(log.motorCount || '—')],
  ]
  let maxIdx = 0
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[maxIdx]) maxIdx = i
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
            <div className="text-sm font-mono-data truncate" title={v}>
              {v}
            </div>
          </div>
        ))}
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Лог в файле ({log.logCount})
          </div>
          {log.logCount > 1 ? (
            <Select
              value={String(log.logIndex)}
              onValueChange={(v) => onSelectLog(parseInt(v, 10))}
              disabled={switching}
            >
              <SelectTrigger className="h-7 mt-0.5 w-full text-xs font-mono-data">
                <SelectValue />
                {switching && <Loader2 className="w-3 h-3 animate-spin ml-1 shrink-0" />}
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: log.logCount }, (_, i) => (
                  <SelectItem key={i} value={String(i)} className="text-xs">
                    Лог {i + 1}
                    {sizes[i] ? ' · ' + (sizes[i] / 1048576).toFixed(1) + ' МБ' : ''}
                    {i === maxIdx ? ' · самый ёмкий' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="text-sm font-mono-data mt-1">1 из 1</div>
          )}
        </div>
      </div>
      {log.truncated && (
        <p className="mt-2 text-xs text-amber-400">
          Лог обрезан при разборе ({log.stopReason}) — анализ выполнен по доступной части.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
          Не удалось разобрать лог: {error}
        </p>
      )}
    </div>
  )
}
