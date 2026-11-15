// Low-level byte reader for Blackbox binary encodings.
// Semantics verified against Betaflight 4.5 sources:
//  - blackbox_encoding.c (writers)
//  - blackbox_fielddefs.h (predictor/encoding ids)

export class ParseError extends Error {}

export class ByteReader {
  pos = 0
  buf: Uint8Array
  constructor(buf: Uint8Array) {
    this.buf = buf
  }

  get remaining(): number {
    return this.buf.length - this.pos
  }

  u8(): number {
    if (this.pos >= this.buf.length) throw new ParseError('unexpected end of data')
    return this.buf[this.pos++]
  }

  peek(): number {
    if (this.pos >= this.buf.length) throw new ParseError('unexpected end of data')
    return this.buf[this.pos]
  }

  /** Unsigned variable-byte */
  readUVB(): number {
    let result = 0
    let shift = 0
    for (;;) {
      const b = this.u8()
      result = (result + (b & 0x7f) * Math.pow(2, shift)) >>> 0
      if (!(b & 0x80)) break
      shift += 7
      if (shift > 35) throw new ParseError('VB value too large')
    }
    return result
  }

  /** Signed variable-byte (zigzag) */
  readSVB(): number {
    const u = this.readUVB()
    return (u & 1) !== 0 ? -((u + 1) >> 1) : u >> 1
  }

  /** NEG_14BIT: unsigned VB, sign-extended from 14 bits, then negated */
  readNeg14(): number {
    let d = this.readUVB() & 0x3fff
    if (d & 0x2000) d -= 0x4000
    return -d
  }

  /**
   * TAG2_3S32: 2-bit selector + 3 signed values.
   * sel 0: 2 bits/field; sel 1: 4 bits/field; sel 2: 6/8/8 bits; sel 3: per-field byte count.
   */
  readTag2_3S32(): [number, number, number] {
    const b = this.u8()
    const sel = b >> 6
    if (sel === 0) {
      const s2 = (v: number) => (v & 2 ? v - 4 : v)
      return [s2((b >> 4) & 3), s2((b >> 2) & 3), s2(b & 3)]
    }
    if (sel === 1) {
      const b2 = this.u8()
      const s4 = (v: number) => (v & 8 ? v - 16 : v)
      return [s4(b & 0x0f), s4(b2 >> 4), s4(b2 & 0x0f)]
    }
    if (sel === 2) {
      const b2 = this.u8()
      const b3 = this.u8()
      const s6 = (v: number) => (v & 32 ? v - 64 : v)
      const s8 = (v: number) => (v & 128 ? v - 256 : v)
      return [s6(b & 0x3f), s8(b2), s8(b3)]
    }
    let sel2 = b & 0x3f
    const out: number[] = []
    for (let x = 0; x < 3; x++) {
      const nBytes = (sel2 & 3) + 1
      sel2 >>= 2
      let v = 0
      for (let i = 0; i < nBytes; i++) v |= this.u8() * Math.pow(2, 8 * i)
      const bits = nBytes * 8
      if (v & Math.pow(2, bits - 1)) v -= Math.pow(2, bits)
      out.push(v)
    }
    return [out[0], out[1], out[2]]
  }

  /**
   * TAG8_4S16: 1 selector byte (4 x 2-bit sizes: 0=zero,1=4bit,2=8bit,3=16bit),
   * then the four values as one continuous MSB-first bit stream occupying
   * ceil(totalBits/8) bytes. Verified against blackboxWriteTag8_4S16 (blackbox_encoding.c).
   */
  readTag8_4S16(): [number, number, number, number] {
    let sel = this.u8()
    const sizes: number[] = []
    for (let i = 0; i < 4; i++) {
      sizes.push(sel & 3)
      sel >>= 2
    }
    const bitsPer = [0, 4, 8, 16]
    let totalBits = 0
    for (const s of sizes) totalBits += bitsPer[s]
    const nBytes = Math.ceil(totalBits / 8)
    const buf: number[] = []
    for (let i = 0; i < nBytes; i++) buf.push(this.u8())
    let bitPos = 0
    const readBits = (nb: number): number => {
      let v = 0
      for (let k = 0; k < nb; k++) {
        const byteIdx = bitPos >> 3
        const bitIdx = 7 - (bitPos & 7)
        v = (v << 1) | ((buf[byteIdx] >> bitIdx) & 1)
        bitPos++
      }
      return v
    }
    const out: number[] = []
    for (const s of sizes) {
      const nb = bitsPer[s]
      if (nb === 0) {
        out.push(0)
        continue
      }
      let v = readBits(nb)
      const signBit = 1 << (nb - 1)
      if (v & signBit) v -= 1 << nb
      out.push(v)
    }
    return [out[0], out[1], out[2], out[3]]
  }

  /**
   * TAG8_8SVB: 1 tag byte (bit i set = field i nonzero), then signed VB per set field.
   * Groups of up to 8 fields; caller decides group size.
   */
  readTag8_8SVB(count: number): number[] {
    const header = this.u8()
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      out.push((header >> i) & 1 ? this.readSVB() : 0)
    }
    // padding bits up to 8 belong to no field (file may set them only within count)
    return out
  }
}

export const ENCODING = {
  SIGNED_VB: 0,
  UNSIGNED_VB: 1,
  NEG_14BIT: 3,
  TAG8_8SVB: 6,
  TAG2_3S32: 7,
  TAG8_4S16: 8,
  NULL: 9,
  TAG2_3SVARIABLE: 10,
} as const

export const PREDICTOR = {
  ZERO: 0,
  PREVIOUS: 1,
  STRAIGHT_LINE: 2,
  AVERAGE_2: 3,
  MINTHROTTLE: 4,
  MOTOR_0: 5,
  INC: 6,
  HOME_COORD: 7,
  P1500: 8,
  VBATREF: 9,
  LAST_MAIN_FRAME_TIME: 10,
  MINMOTOR: 11,
} as const
