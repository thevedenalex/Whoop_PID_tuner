#!/usr/bin/env python3
"""Generate a synthetic Betaflight 4.5-style .bbl demo log.

Mirrors the encoders in betaflight/src/main/blackbox/blackbox_encoding.c so the
app's decoder can be verified end-to-end. Bakes in known flight behaviour:
- roll/pitch step overshoot ~20%
- settle time ~170 ms
- gyro noise: ~6 dps hover, ~26 dps full throttle
- motor saturation ~6% of the time
"""
import math
import random
import struct
import sys

random.seed(42)

DT_US = 500          # logged at 2 kHz (every 4th of 8 kHz loop)
FRAMES = 50000       # 25 s
I_INTERVAL = 32
VBATREF = 330        # 3.30 V in 0.01 V units... stored as 0.1V -> 330 = 33.0? see below
MOTOR_LOW = 0
MOTOR_HIGH = 1000

# ---------------- encoders (ported from blackbox_encoding.c) ----------------

def uvb(v):
    v &= 0xFFFFFFFF
    out = bytearray()
    while v > 127:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)
    return bytes(out)

def zz(v):
    return 2 * v if v >= 0 else -2 * v - 1

def svb(v):
    return uvb(zz(v))

def neg14(v):
    return uvb((VBATREF - v) & 0x3FFF)

def tag8_8svb(vals):
    n = len(vals)
    if n == 1:
        return svb(vals[0])
    header = 0
    for i in range(n - 1, -1, -1):
        header <<= 1
        if vals[i] != 0:
            header |= 1
    out = bytearray([header])
    for v in vals:
        if v != 0:
            out += svb(v)
    return bytes(out)

def tag8_4s16(vals):
    sel = 0
    for x in range(3, -1, -1):
        sel <<= 2
        v = vals[x]
        if v == 0:
            sel |= 0
        elif -8 <= v < 8:
            sel |= 1
        elif -128 <= v < 128:
            sel |= 2
        else:
            sel |= 3
    out = bytearray([sel])
    nib = 0
    buf = 0
    sel2 = sel
    for x in range(4):
        mode = sel2 & 3
        sel2 >>= 2
        v = vals[x]
        if mode == 0:
            pass
        elif mode == 1:
            if nib == 0:
                buf = (v << 4) & 0xFF
                nib = 1
            else:
                out.append((buf | (v & 0x0F)) & 0xFF)
                nib = 0
        elif mode == 2:
            if nib == 0:
                out.append(v & 0xFF)
            else:
                out.append((buf | ((v >> 4) & 0x0F)) & 0xFF)
                buf = (v << 4) & 0xFF
        else:
            if nib == 0:
                out.append((v >> 8) & 0xFF)
                out.append(v & 0xFF)
            else:
                out.append((buf | ((v >> 12) & 0x0F)) & 0xFF)
                out.append((v >> 4) & 0xFF)
                buf = (v << 4) & 0xFF
    if nib == 1:
        out.append(buf & 0xFF)
    return bytes(out)

def tag2_3s32(vals):
    sel = 0
    for v in vals:
        if v >= 32 or v < -32:
            sel = 3
            break
        if v >= 8 or v < -8:
            sel = max(sel, 2)
        elif v >= 2 or v < -2:
            sel = max(sel, 1)
    out = bytearray()
    if sel == 0:
        out.append((vals[0] & 3) << 4 | (vals[1] & 3) << 2 | (vals[2] & 3))
    elif sel == 1:
        out.append((1 << 6) | (vals[0] & 0x0F))
        out.append(((vals[1] & 0x0F) << 4) | (vals[2] & 0x0F))
    elif sel == 2:
        out.append((2 << 6) | (vals[0] & 0x3F))
        out.append(vals[1] & 0xFF)
        out.append(vals[2] & 0xFF)
    else:
        sel2 = 0
        for x in range(2, -1, -1):
            sel2 <<= 2
            v = vals[x]
            if -128 <= v < 128:
                sel2 |= 0
            elif -32768 <= v < 32768:
                sel2 |= 1
            elif -8388608 <= v < 8388608:
                sel2 |= 2
            else:
                sel2 |= 3
        out.append((3 << 6) | sel2)
        for x in range(3):
            mode = (sel2 >> (2 * x)) & 3
            n = mode + 1
            for i in range(n):
                out.append((vals[x] >> (8 * i)) & 0xFF)
    return bytes(out)

# ---------------- flight model ----------------

def step_response(u):
    """Underdamped 2nd-order step response, overshoot ~20%, 10-90% rise ~30 ms."""
    if u <= 0:
        return 0.0
    zeta = 0.455
    wn = 2 * math.pi * 11.0          # ~11 Hz natural
    wd = wn * math.sqrt(1 - zeta * zeta)
    return 1 - math.exp(-zeta * wn * u) * (math.cos(wd * u) + (zeta * wn / wd) * math.sin(wd * u))

# schedule of stick steps: (start_s, axis, target_dps, duration_s)
STEPS = []
t = 6.0
for i in range(14):
    axis = 0 if i % 2 == 0 else 1
    tgt = 450 if (i // 2) % 2 == 0 else -420
    STEPS.append((t, axis, tgt, 0.30))
    t += 0.85
for i in range(3):
    STEPS.append((t, 2, 380 if i % 2 == 0 else -360, 0.3))
    t += 1.0

def throttle_at(tt):
    if 18.0 <= tt <= 19.5:
        return 1000.0
    if tt < 5:
        return 300.0
    base = 320.0 + 90.0 * math.sin(tt * 1.7) + 40.0 * math.sin(tt * 4.3)
    return max(120.0, min(760.0, base))

def sp_at(tt, axis):
    for (t0, ax, tgt, dur) in STEPS:
        if ax == axis and t0 <= tt < t0 + dur:
            return tgt
    return 0.0


def encode():
    out = bytearray()
    n = FRAMES
    hist = {'full': None, 'prev': None}

    states = [frame_state_memo(i) for i in range(n)]

    def avg2(idx_vals):
        pass

    for i in range(n):
        st = states[i]
        (vbat, amp, rssi, acc, motors, ap, ai, ad, af, rc, spn, g, tm) = st
        if i % I_INTERVAL == 0 or hist['full'] is None:
            out += b'I'
            out += uvb(i)
            out += uvb(i * DT_US)
            for v in ap: out += svb(v)
            for v in ai: out += svb(v)
            for v in ad: out += svb(v)
            for v in af: out += svb(v)
            for v in rc[:3]: out += svb(v)
            out += uvb(rc[3])
            for v in spn: out += svb(v)
            out += neg14(vbat)
            out += svb(amp)
            out += uvb(rssi)
            for v in g: out += svb(v)
            for v in acc: out += svb(v)
            out += uvb(motors[0] - MOTOR_LOW)
            for x in range(1, 4):
                out += svb(motors[x] - motors[0])
            # как в энкодере BF: после I-фрейма обе позиции истории = его значениям
            hist['prev'] = st
            hist['full'] = st
        else:
            L = hist['full']
            P = hist['prev'] if hist['prev'] is not None else hist['full']
            out += b'P'
            # time: straight-line predictor; 2nd-order delta (0 in steady state, 500us right after the first I-frame)
            out += svb(i * DT_US - 2 * L[12] + P[12])
            # axisP
            for a in range(3): out += svb(ap[a] - L[5][a])
            # axisI as TAG2_3S32
            out += tag2_3s32([ai[a] - L[6][a] for a in range(3)])
            # axisD
            for a in range(3): out += svb(ad[a] - L[7][a])
            # axisF
            for a in range(3): out += svb(af[a] - L[8][a])
            # rcCommand TAG8_4S16
            out += tag8_4s16([rc[a] - L[9][a] for a in range(4)])
            # setpoint TAG8_4S16
            out += tag8_4s16([spn[a] - L[10][a] for a in range(4)])
            # optional group TAG8_8SVB: vbat, amperage, rssi
            out += tag8_8svb([vbat - L[0], amp - L[1], rssi - L[2]])
            # gyro AVG2
            for a in range(3):
                pred = int((L[11][a] + P[11][a]) / 2)
                out += svb(g[a] - pred)
            # acc AVG2
            for a in range(3):
                pred = int((L[3][a] + P[3][a]) / 2)
                out += svb(acc[a] - pred)
            # motors AVG2
            for m in range(4):
                pred = int((L[4][m] + P[4][m]) / 2)
                out += svb(motors[m] - pred)
            hist['prev'] = hist['full']
            hist['full'] = st

    # LOG_END event
    out += b'E' + bytes([255])
    return bytes(out)

_state_cache = {}
def frame_state_memo(i):
    if i in _state_cache:
        return _state_cache[i]
    st = _build_state(i)
    _state_cache[i] = st
    return st

def _build_state(i):
    tt = i * DT_US / 1e6
    vbat = int(435 - (tt / 25.0) * 45)
    thr = throttle_at(tt)
    amp = int(1500 + thr * 22 + random.gauss(0, 60))
    rssi = int(920 + random.gauss(0, 25))
    acc = [int(30 * math.sin(tt * 3)), int(25 * math.sin(tt * 2.1)), int(512 + 40 * math.sin(tt * 1.2))]
    motors = []
    for m in range(4):
        base = thr * 0.92 + 25
        jitter = random.gauss(0, 8 + thr * 0.02)
        v = int(base + jitter)
        if 18.0 <= tt <= 19.5:
            v = int(985 + random.gauss(0, 6))
        motors.append(max(MOTOR_LOW, min(MOTOR_HIGH, v)))
    spn = [int(sp_at(tt, a)) for a in range(3)] + [int(thr)]
    g = [int(_gyro[a][i]) for a in range(3)]
    ap = [int((spn[a] - g[a]) * 0.35 + random.gauss(0, 6)) for a in range(3)]
    ai = [int(12 + 8 * math.sin(tt * 0.9 + a) + random.gauss(0, 3)) for a in range(3)]
    ad = [int((g[a] - (_gyro[a][i - 1] if i > 0 else g[a])) * 18 + random.gauss(0, 5)) if a < 2 else 0 for a in range(3)]
    af = [int(spn[a] * 0.8) for a in range(3)]
    rc = [int(max(-500, min(500, spn[a] * 0.9))) for a in range(3)] + [int(thr)]
    return (vbat, amp, rssi, acc, motors, ap, ai, ad, af, rc, spn, g, i * DT_US)

# precompute gyro traces
_gyro = None
def precompute_gyro():
    global _gyro
    n = FRAMES
    gyro = [[0.0] * n for _ in range(3)]
    thr = [0.0] * n
    DELAY = 0.012
    for i in range(n):
        tt = i * DT_US / 1e6
        thr[i] = throttle_at(tt)
    for (t0, ax, tgt, dur) in STEPS:
        i0 = int(t0 * 1e6 / DT_US)
        for i in range(i0, n):
            u = (i - i0) * DT_US / 1e6 - DELAY
            h = step_response(u)
            h_end = step_response(u - dur)
            gyro[ax][i] += tgt * (h - h_end)
    for i in range(n):
        noise_amp = 6.0 + (thr[i] / 1000.0) ** 2 * 20.0
        for a in range(3):
            gyro[a][i] += random.gauss(0, noise_amp)
    _gyro = gyro

HEADERS = """H Product:Blackbox flight data recorder by Nicholas Sherlock
H Data version:2
H I interval:{i}
H P interval:1/8
H P ratio:8
H minthrottle:1070
H maxthrottle:2000
H gyro_sync_denom:1
H acc_1G:512
H motorOutput:0,1000
H vbatref:330
H vbatscale:110
H vbatcellvoltage:330,350,430,440
H currentSensor:0,0
H looptime:125
H gyro_lpf1_type:PT1
H gyro_lpf2_type:PT1
H rates_type:3
H rc_rates:33,33,26
H rc_expo:15,15,15
H rates:72,70,56
H tpa:0
H tpa_breakpoint:1650
H motor_pwm_protocol:DSHOT300
H dterm_lpf1_type:PT1
H dterm_lpf2_type:PT1
H Craft name:TW65-racer
H Firmware type:Betaflight
H Firmware revision:4.5.1 (SYNTHETIC DEMO)
H Firmware date:Jan 01 2026 00:00:00
H Field I name:loopIteration,time,axisP[0],axisP[1],axisP[2],axisI[0],axisI[1],axisI[2],axisD[0],axisD[1],axisD[2],axisF[0],axisF[1],axisF[2],rcCommand[0],rcCommand[1],rcCommand[2],rcCommand[3],setpoint[0],setpoint[1],setpoint[2],setpoint[3],vbatLatest,amperageLatest,rssi,gyroADC[0],gyroADC[1],gyroADC[2],accSmooth[0],accSmooth[1],accSmooth[2],motor[0],motor[1],motor[2],motor[3]
H Field I signed:0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1,1,0,1,0,1,1,1,1,1,1,0,1,1,1
H Field I predictor:0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,0,0,0,0,0,0,0,0,11,5,5,5
H Field I encoding:1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,3,0,1,0,0,0,0,0,0,1,0,0,0
H Field P predictor:6,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,3,3,3,3,3,3,3,3,3,3
H Field P encoding:9,0,0,0,0,7,7,7,0,0,0,0,0,0,8,8,8,8,8,8,8,8,6,6,6,0,0,0,0,0,0,0,0,0,0
H Field S name:flightModeFlags,stateFlags,failsafePhase,rxSignalReceived,rxFlightChannelsValid
H Field S signed:0,0,0,0,0
H Field S predictor:0,0,0,0,0
H Field S encoding:1,1,7,7,7
""".format(i=I_INTERVAL).encode('ascii')

def main():
    precompute_gyro()
    frames = encode()
    with open(sys.argv[1] if len(sys.argv) > 1 else 'demo.bbl', 'wb') as f:
        f.write(HEADERS)
        f.write(frames)
    print('frames bytes:', len(frames))
    # ground truth summary
    print('expected: overshoot ~20%, settle ~170ms, delay 12ms')
    print('expected: noise hover ~6 dps, full ~26 dps (ratio ~4.3)')
    print('expected: motor saturation during 18.0-19.5s punch (motors ~985-1000)')

if __name__ == '__main__':
    main()
