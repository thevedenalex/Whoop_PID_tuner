// Betaflight Blackbox (.bbl) parser: headers + binary I/P/S/G/H frames.
// Decoding semantics verified against Betaflight 4.5 maintenance sources
// (blackbox.c, blackbox_encoding.c, blackbox_fielddefs.h).

import { ByteReader, ParseError, ENCODING } from './reader'
import type { BblHeaders, FieldData, NumArr, ParsedLog } from './types'
import { isStoredField } from './types'

const MAX_FRAMES = 500000
const HEADER_MAGIC = 'H Product:Blackbox'

interface Ctx {
  vbatref: number
  minthrottle: number
  motorOutputLow: number
  motor0Index: number
  lastMainTime: number
}

// События Betaflight (FlightLogEvent). Полезная нагрузка — как пишет blackbox.c:
// целые записываются переменным байтом (UVB), а не фиксированными u32.
function skipEvent(r: ByteReader, ev: number): void {
  switch (ev) {
    case 0: // SYNC_BEEP — u32 time (UVB)
      r.readUVB()
      break
    case 13: // INFLIGHT_ADJUSTMENT — u8 func (флаг float в бите 7) + 4 байта значения
      r.u8()
      r.pos += 4
      break
    case 14: // LOGGING_RESUME — u32 logIteration + u32 currentTime (оба UVB)
      r.readUVB()
      r.readUVB()
      break
    case 15: // DISARM — u32 reason (UVB)
      r.readUVB()
      break
    case 30: // FLIGHTMODE — u32 flags + u32 lastFlags (оба UVB)
      r.readUVB()
      r.readUVB()
      break
    case 255: // LOG_END — без полезной нагрузки
      break
    default:
      throw new ParseError('неизвестное событие ' + ev)
  }
}

function asciiAt(buf: Uint8Array, pos: number, len: number): string {
  let s = ''
  for (let i = 0; i < len && pos + i < buf.length; i++) s += String.fromCharCode(buf[pos + i])
  return s
}

function parseIntList(s: string): number[] {
  if (!s) return []
  return s
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => !isNaN(x))
}

function findLogStart(buf: Uint8Array, index: number): number {
  let found = 0
  for (let i = 0; i + HEADER_MAGIC.length < buf.length; i++) {
    if (asciiAt(buf, i, HEADER_MAGIC.length) === HEADER_MAGIC) {
      if (found === index) return i
      found++
      i += HEADER_MAGIC.length
    }
  }
  return -1
}

// Смещения начала каждого лога в файле (для выбора лога и оценки его размера)
export function listLogStarts(buf: Uint8Array): number[] {
  const starts: number[] = []
  for (let i = 0; i + HEADER_MAGIC.length < buf.length; i++) {
    if (asciiAt(buf, i, HEADER_MAGIC.length) === HEADER_MAGIC) {
      starts.push(i)
      i += HEADER_MAGIC.length
    }
  }
  return starts
}

export function countLogs(buf: Uint8Array): number {
  return Math.max(listLogStarts(buf).length, 1)
}

function applyPredictor(pred: number, i: number, last: Int32Array, prev2: Int32Array, current: Int32Array, ctx: Ctx): number {
  switch (pred) {
    case 0: // ZERO
      return 0
    case 1: // PREVIOUS
      return last[i]
    case 2: // STRAIGHT_LINE
      return 2 * last[i] - prev2[i]
    case 3: {
      // AVERAGE_2 (C integer division truncates toward zero)
      return Math.trunc((last[i] + prev2[i]) / 2)
    }
    case 4: // MINTHROTTLE
      return ctx.minthrottle
    case 5: {
      // MOTOR_0: same as motor[0] of the current frame (blackbox-tools parser.c)
      const m0 = ctx.motor0Index
      return current[m0]
    }
    case 6: // INC
      return last[i] + 1
    case 8: // P1500
      return 1500
    case 9: // VBATREF
      return ctx.vbatref
    case 10: // LAST_MAIN_FRAME_TIME
      return ctx.lastMainTime
    case 11: // MINMOTOR
      return ctx.motorOutputLow
    default:
      return 0
  }
}

function readTagGroup(r: ByteReader, enc: number, count: number): number[] {
  switch (enc) {
    case ENCODING.TAG8_8SVB:
      // Betaflight пишет заголовок только для групп из 2+ полей;
      // одиночное поле TAG8_8SVB — это просто один signed VB (blackboxWriteTag8_8SVB).
      if (count === 1) return [r.readSVB()]
      return r.readTag8_8SVB(count)
    case ENCODING.TAG8_4S16: {
      const v = r.readTag8_4S16()
      const out = [v[0], v[1], v[2], v[3]]
      return out.slice(0, count)
    }
    case ENCODING.TAG2_3S32: {
      const v = r.readTag2_3S32()
      return [v[0], v[1], v[2]].slice(0, count)
    }
    default:
      throw new ParseError('not a tag encoding')
  }
}

function tagGroupSize(enc: number): number {
  if (enc === ENCODING.TAG8_8SVB) return 8
  if (enc === ENCODING.TAG8_4S16) return 4
  if (enc === ENCODING.TAG2_3S32) return 3
  return 1
}

function readFieldValue(r: ByteReader, enc: number): number {
  switch (enc) {
    case ENCODING.SIGNED_VB:
      return r.readSVB()
    case ENCODING.UNSIGNED_VB:
      return r.readUVB()
    case ENCODING.NEG_14BIT:
      return r.readNeg14()
    case ENCODING.NULL:
      return 0
    default:
      throw new ParseError('unsupported scalar encoding ' + enc)
  }
}

export async function parseBbl(
  buf: Uint8Array,
  logIndex: number,
  onProgress?: (frames: number) => void
) {
  const logCount = countLogs(buf)
  const start = findLogStart(buf, logIndex)
  if (start === -1) throw new ParseError('лог не найден в файле')

  // Parse "H key:value" lines, remembering order because Field I predictor/encoding headers repeat for P-frames
  const headerOrder: { key: string; value: string }[] = []
  {
    let p = start
    while (p + 2 < buf.length && buf[p] === 0x48 && buf[p + 1] === 0x20) {
      p += 2
      let line = ''
      while (p < buf.length && buf[p] !== 0x0a) line += String.fromCharCode(buf[p++])
      p++
      const colon = line.indexOf(':')
      if (colon !== -1) headerOrder.push({ key: line.slice(0, colon).trim(), value: line.slice(colon + 1) })
    }
  }
  const fieldHeader = (frame: string, suffix: string, occurrence: number): string => {
    let seen = -1
    for (const h of headerOrder) {
      if (h.key === 'Field ' + frame + ' ' + suffix) {
        seen++
        if (seen === occurrence) return h.value
      }
    }
    return ''
  }
  const firstHeader = (key: string): string => {
    for (const h of headerOrder) if (h.key === key) return h.value
    return ''
  }

  const headers: BblHeaders = {}
  for (const h of headerOrder) if (!(h.key in headers)) headers[h.key] = h.value

  const names = (fieldHeader('I', 'name', 0) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const predI = parseIntList(fieldHeader('I', 'predictor', 0))
  const encI = parseIntList(fieldHeader('I', 'encoding', 0))
  const predP = parseIntList(
    fieldHeader('I', 'predictor', 1) || fieldHeader('P', 'predictor', 0)
  )
  const encP = parseIntList(
    fieldHeader('I', 'encoding', 1) || fieldHeader('P', 'encoding', 0)
  )

  const n = names.length
  if (n === 0 || encI.length !== n || predI.length !== n) {
    throw new ParseError('несогласованные заголовки полей (не Betaflight-лог?)')
  }
  const hasP = encP.length === n && predP.length === n

  const motor0Index = names.indexOf('motor[0]')
  const ctx: Ctx = {
    vbatref: parseInt(firstHeader('vbatref') || '330', 10),
    minthrottle: parseInt(firstHeader('minthrottle') || '1070', 10),
    motorOutputLow: parseInt((firstHeader('motorOutput') || '0,1000').split(',')[0] || '0', 10),
    motor0Index: motor0Index === -1 ? 0 : motor0Index,
    lastMainTime: 0,
  }

  const storedIdx: number[] = []
  for (let i = 0; i < n; i++) {
    if (isStoredField(names[i])) storedIdx.push(i)
  }
  const buckets: number[][] = storedIdx.map(() => [])

  const last = new Int32Array(n)
  const prev2 = new Int32Array(n)
  let frameCount = 0
  let truncated = false
  let stopReason = ''
  let framesSinceYield = 0

  const decodeMain = (isIntra: boolean) => {
    const preds = isIntra ? predI : predP
    const encs = isIntra ? encI : encP
    const out = new Int32Array(n)
    let i = 0
    while (i < n) {
      const enc = encs[i]
      const group = tagGroupSize(enc)
      if (group > 1) {
        // consecutive fields sharing a tag encoding form one group (BF writes one tag per run)
        let run = 1
        while (i + run < n && run < group && encs[i + run] === enc) run++
        const values = readTagGroup(r, enc, run)
        for (let k = 0; k < run; k++) {
          out[i + k] = applyPredictor(preds[i + k], i + k, last, prev2, out, ctx) + values[k]
        }
        i += run
      } else {
        const v = readFieldValue(r, enc)
        out[i] = applyPredictor(preds[i], i, last, prev2, out, ctx) + v
        i++
      }
    }
    const timeIdx = names.indexOf('time')
    if (isIntra && timeIdx !== -1) ctx.lastMainTime = out[timeIdx]
    for (let s = 0; s < storedIdx.length; s++) {
      buckets[s].push(out[storedIdx[s]])
    }
    if (isIntra) {
      // после I-фрейма обе позиции истории совпадают с ним:
      // иначе STRAIGHT_LINE/AVERAGE_2 в первом P-фрейме получают prev2=0 и взрываются
      prev2.set(out)
    } else {
      prev2.set(last)
    }
    last.set(out)
    frameCount++
  }

  const decodeSlow = () => {
    const sNames = (firstHeader('Field S name') || '').split(',').map((s) => s.trim()).filter(Boolean)
    const sEnc = parseIntList(firstHeader('Field S encoding'))
    let i = 0
    while (i < sNames.length && i < sEnc.length) {
      const enc = sEnc[i]
      if (enc === ENCODING.TAG2_3S32) {
        r.readTag2_3S32()
        i += 3
      } else {
        readFieldValue(r, enc)
        i++
      }
    }
  }

  const skipGps = (which: string) => {
    const gNames = (firstHeader('Field ' + which + ' name') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const gEnc = parseIntList(firstHeader('Field ' + which + ' encoding'))
    if (!gNames.length || gEnc.length !== gNames.length) throw new ParseError('нет описания GPS-полей')
    let i = 0
    while (i < gNames.length) {
      const enc = gEnc[i]
      const group = tagGroupSize(enc)
      if (group > 1) {
        let run = 1
        while (i + run < gNames.length && run < group && gEnc[i + run] === enc) run++
        readTagGroup(r, enc, run)
        i += run
      } else {
        readFieldValue(r, enc)
        i++
      }
    }
  }

  const r = new ByteReader(buf)
  r.pos = start
  // skip the header lines we already indexed
  while (r.remaining > 1 && r.peek() === 0x48 && r.buf[r.pos + 1] === 0x20) {
    while (r.remaining > 0 && r.buf[r.pos] !== 0x0a) r.pos++
    if (r.remaining > 0) r.pos++
  }

  try {
    for (;;) {
      if (r.remaining < 1) {
        stopReason = 'конец файла'
        truncated = frameCount === 0
        break
      }
      const type = r.u8()
      if (type === 0x49) {
        decodeMain(true) // 'I'
      } else if (type === 0x50) {
        if (!hasP) throw new ParseError('P-фрейм без описания полей')
        decodeMain(false) // 'P'
      } else if (type === 0x45) {
        // 'E' event
        if (r.remaining < 1) {
          stopReason = 'обрыв данных в событии'
          truncated = true
          break
        }
        const ev = r.u8()
        if (ev === 255) {
          stopReason = 'конец лога (LOG_END)'
          break
        }
        try {
          skipEvent(r, ev)
        } catch (e) {
          stopReason = e instanceof ParseError ? e.message : 'ошибка события: ' + String(e)
          break
        }
      } else if (type === 0x53) {
        decodeSlow() // 'S'
      } else if (type === 0x47) {
        skipGps('G')
      } else if (type === 0x48) {
        // 'H' — GPS home frame, or start of the next log ("H Product:...")
        if (r.remaining > 9 && asciiAt(buf, r.pos, 9) === ' Product:') {
          stopReason = 'начало следующего лога в файле'
          break
        }
        skipGps('H')
      } else {
        stopReason = 'неизвестный тип фрейма 0x' + type.toString(16)
        break
      }

      framesSinceYield++
      if (framesSinceYield >= 20000) {
        framesSinceYield = 0
        onProgress?.(frameCount)
        await new Promise((res) => setTimeout(res, 0))
      }
      if (frameCount >= MAX_FRAMES) {
        stopReason = 'достигнут лимит ' + MAX_FRAMES + ' фреймов — лог обрезан'
        truncated = true
        break
      }
    }
  } catch (e) {
    truncated = true
    stopReason = e instanceof ParseError ? e.message : 'ошибка разбора: ' + String(e)
  }

  const data: FieldData = {}
  for (let s = 0; s < storedIdx.length; s++) {
    const name = names[storedIdx[s]]
    // time/loopIteration grow beyond Float32 integer precision — keep them in 64 bits
    data[name] =
      name === 'time' || name === 'loopIteration'
        ? new Float64Array(buckets[s])
        : new Float32Array(buckets[s])
  }

  let loopHz = 0
  const times = data['time']
  // time в BF — uint32 мкс, переполняется через ~71.6 мин: разворачиваем в монотонную шкалу
  if (times && times.length > 1) {
    const WRAP_US = 4294967296
    const HALF = 2147483648
    let offset = 0
    for (let i = 1; i < times.length; i++) {
      if (times[i] < times[i - 1] - HALF) offset += WRAP_US
      times[i] = times[i] + offset
    }
  }
  const durationMs = times && times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0
  if (times && times.length > 10) {
    const dts: number[] = []
    for (let i = 1; i < Math.min(times.length, 20000); i++) {
      const dt = times[i] - times[i - 1]
      if (dt > 0 && dt < 100000) dts.push(dt)
    }
    dts.sort((a, b) => a - b)
    const med = dts[Math.floor(dts.length / 2)]
    if (med) loopHz = Math.round(1000000 / med)
  }

  const result: ParsedLog = {
    headers,
    fieldNames: names,
    frameCount,
    truncated,
    stopReason,
    data,
    loopHz,
    durationMs,
    motorCount: motor0Index === -1 ? 0 : names.filter((x) => x.startsWith('motor[')).length,
    gyroRes: 1,
    logIndex,
    logCount,
  }
  return result
}

export function getField(log: ParsedLog, name: string): NumArr | null {
  return log.data[name] || null
}

export function getVec(log: ParsedLog, base: string, count: number): (NumArr | null)[] {
  const out: (NumArr | null)[] = []
  for (let i = 0; i < count; i++) out.push(log.data[base + '[' + i + ']'] || null)
  return out
}
