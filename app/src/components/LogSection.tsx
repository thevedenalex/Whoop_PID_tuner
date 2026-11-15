import { useCallback, useRef, useState } from 'react'
import { UploadCloud, FileBox, Loader2, FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { parseBbl, listLogStarts } from '@/lib/bbl/parser'
import { analyzeLog } from '@/lib/analyze/metrics'
import LogInfoBar from '@/components/LogInfoBar'
import type { ParsedLog } from '@/lib/bbl/types'
import type { LogMetrics } from '@/lib/analyze/metrics'

export interface LoadedLog {
  log: ParsedLog
  metrics: LogMetrics
  fileName: string
  buf: Uint8Array // буфер файла — для переключения между логами
  sizes: number[] // размер каждого лога в байтах
}

// Верхний блок страницы: выбор лога (слева) + демо и характеристики (справа).
export default function LogSection(props: {
  onLoaded: (l: LoadedLog) => void
  log: ParsedLog | null
  fileName: string | null
  sizes: number[] | null
  switching: boolean
  error: string | null
  onSelectLog: (index: number) => void
}) {
  const inputRef = useRef(null as HTMLInputElement | null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFile = useCallback(
    async (file: File | null, fromDemo: boolean) => {
      setBusy(true)
      setLocalError(null)
      setProgress('Чтение файла…')
      try {
        let buf: Uint8Array
        let name: string
        if (fromDemo) {
          const resp = await fetch('demo.bbl')
          if (!resp.ok) throw new Error('демо-лог не найден (demo.bbl)')
          buf = new Uint8Array(await resp.arrayBuffer())
          name = 'demo.bbl (синтетический)'
        } else {
          if (!file) return
          buf = new Uint8Array(await file.arrayBuffer())
          name = file.name
        }
        setProgress('Разбор заголовков…')
        // Авто-выбор самого информативного лога: размер секции в файле коррелирует
        // с числом фреймов (пустые логи с земли — маленькие).
        const starts = listLogStarts(buf)
        const sizes = starts.map((s, i) => (i + 1 < starts.length ? starts[i + 1] : buf.length) - s)
        let pick = 0
        let bestSize = -1
        for (let i = 0; i < sizes.length; i++) {
          if (sizes[i] > bestSize) {
            bestSize = sizes[i]
            pick = i
          }
        }
        const log = await parseBbl(buf, pick, (frames) => setProgress('Декодирование фреймов: ' + frames.toLocaleString('ru-RU')))
        setProgress('Анализ полёта…')
        await new Promise((r) => setTimeout(r, 10))
        const metrics = analyzeLog(log)
        props.onLoaded({ log, metrics, fileName: name, buf, sizes })
        setProgress(null)
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : String(e))
        setProgress(null)
      } finally {
        setBusy(false)
      }
    },
    [props]
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileBox className="w-4 h-4 text-primary" />
          Шаг 1. Blackbox-лог (.bbl)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4 items-start">
          <div className="space-y-3">
            <div
              role="button"
              tabIndex={0}
              aria-label="Загрузить .bbl файл"
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click()
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void handleFile(f, false)
              }}
              className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-primary bg-accent' : 'border-border hover:border-muted-foreground/50'
              } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {busy ? (
                <>
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">{progress ?? 'Обработка…'}</p>
                </>
              ) : (
                <>
                  <UploadCloud className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm">
                    Перетащите <span className="font-mono-data text-primary">.bbl</span> сюда или нажмите для выбора
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Файл обрабатывается локально в браузере — никуда не отправляется
                  </p>
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".bbl,.BFL,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f, false)
                e.target.value = ''
              }}
            />
            {localError && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{localError}</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleFile(null, true)}
                className="gap-2"
              >
                <FlaskConical className="w-4 h-4" />
                Демо-лог без файла
              </Button>
              {progress && !busy && <span className="text-xs text-muted-foreground">{progress}</span>}
            </div>
            <LogInfoBar
              log={props.log}
              fileName={props.fileName}
              sizes={props.sizes}
              switching={props.switching}
              error={props.error}
              onSelectLog={props.onSelectLog}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
