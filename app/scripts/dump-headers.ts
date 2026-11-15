// Вывод всех заголовков H key:value из .bbl-лога
import { readFileSync } from 'fs'
import { parseBbl } from '@/lib/bbl/parser'

const buf = new Uint8Array(readFileSync(process.argv[2]))
const idx = parseInt(process.argv[3] || '0', 10)
const log = await parseBbl(buf, idx)
console.log('=== ' + process.argv[2] + ' [лог ' + idx + '] — ' + Object.keys(log.headers).length + ' заголовков')
for (const k of Object.keys(log.headers)) console.log(k + ' = ' + log.headers[k])
