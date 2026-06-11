import { useEffect, useRef, useState } from 'react'

export type WheelSliceView = {
  id: string
  label: string
  sublabel?: string
  /** sources from the live TMDB catalog rather than the local library */
  catalog?: boolean
}

export type SpinCommand = { seq: number; index: number }

const SIZE = 640
const C = SIZE / 2
const R = 256
const BEZEL = 24
const BULBS = 24

export const PALETTE = [
  '#7f2a35', // oxblood
  '#9a6b27', // brass
  '#34564f', // pine
  '#553a5e', // plum
  '#94452c', // rust
  '#2e4a63', // midnight
  '#6d6230', // olive
  '#5e3142', // mulberry
]

export function sliceColor(i: number, n: number): string {
  // avoid the last slice matching slice 0 around the seam
  if (i === n - 1 && i % PALETTE.length === 0) return PALETTE[1]
  return PALETTE[i % PALETTE.length]
}

function polar(angleDeg: number, radius: number) {
  const a = (angleDeg * Math.PI) / 180
  // round so SSR and client markup match exactly (float trig differs across engines)
  return {
    x: Math.round((C + radius * Math.cos(a)) * 100) / 100,
    y: Math.round((C + radius * Math.sin(a)) * 100) / 100,
  }
}

function arcPath(a0: number, a1: number, r: number): string {
  const large = a1 - a0 > 180 ? 1 : 0
  const p0 = polar(a0, r)
  const p1 = polar(a1, r)
  return `M ${C} ${C} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z`
}

let audioCtx: AudioContext | null = null

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
  } catch {
    return null
  }
}

export function playTick() {
  const ac = ctx()
  if (!ac) return
  const o = ac.createOscillator()
  const g = ac.createGain()
  o.type = 'triangle'
  o.frequency.value = 1900
  g.gain.setValueAtTime(0.06, ac.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.045)
  o.connect(g)
  g.connect(ac.destination)
  o.start()
  o.stop(ac.currentTime + 0.05)
}

function playSettle() {
  const ac = ctx()
  if (!ac) return
  const notes = [659.25, 880] // E5 → A5
  notes.forEach((freq, i) => {
    const t = ac.currentTime + i * 0.13
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    o.connect(g)
    g.connect(ac.destination)
    o.start(t)
    o.stop(t + 0.55)
  })
}

type WheelProps = {
  slices: WheelSliceView[]
  command: SpinCommand | null
  muted: boolean
  onSettle: (index: number) => void
}

export default function Wheel({ slices, command, muted, onSettle }: WheelProps) {
  const [rot, setRot] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [settled, setSettled] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const rotRef = useRef(0)
  const lastSeq = useRef(0)
  const mutedRef = useRef(muted)
  const onSettleRef = useRef(onSettle)
  mutedRef.current = muted
  onSettleRef.current = onSettle

  const n = Math.max(slices.length, 1)
  const seg = 360 / n

  useEffect(() => {
    if (!command || command.seq === lastSeq.current) return
    lastSeq.current = command.seq
    setSettled(null)
    setSpinning(true)

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const jitter = (Math.random() - 0.5) * seg * 0.66
    // slice i center sits at -90 + (i + 0.5) * seg + rot; the pointer is at -90
    const targetMod = (((-(command.index + 0.5) * seg + jitter) % 360) + 360) % 360
    const start = rotRef.current
    const startMod = ((start % 360) + 360) % 360
    let delta = targetMod - startMod
    while (delta <= 0) delta += 360
    const turns = reduce ? 0 : 6 + Math.floor(Math.random() * 2)
    const total = turns * 360 + delta
    const duration = reduce ? 700 : 6200 + Math.random() * 1400
    const t0 = performance.now()
    let lastBoundary = Math.floor(start / seg)
    let raf = 0

    let zoomReset = 0
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - t, 4)
      const r = start + total * eased
      rotRef.current = r
      setRot(r)
      // lean in as the wheel winds down — ease-out so most of the zoom lands
      // while the outcome is still up in the air
      if (!reduce) {
        const p = Math.max(0, (t - 0.25) / 0.75)
        setZoom(1 + 1.0 * (1 - Math.pow(1 - p, 2)))
      }
      const b = Math.floor(r / seg)
      if (b !== lastBoundary) {
        lastBoundary = b
        if (!mutedRef.current) playTick()
      }
      if (t < 1) {
        raf = requestAnimationFrame(frame)
      } else {
        setSpinning(false)
        setSettled(command.index)
        if (!mutedRef.current) playSettle()
        onSettleRef.current(command.index)
        zoomReset = window.setTimeout(() => setZoom(1), 1400)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(zoomReset)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.seq])

  const fontSize =
    n <= 6 ? 17.5 : n <= 9 ? 16 : n <= 12 ? 14.5 : n <= 16 ? 13 : n <= 22 ? 11.5 : 10
  // sublabels get unreadable past ~20 slices
  const showSublabels = n <= 20
  // labels are right-anchored near the rim and run inward; budget the chars
  // so they never cross the hub or spill past the edge
  const labelEnd = R - 18
  const maxChars = Math.max(8, Math.floor((labelEnd - 62) / (fontSize * 0.54)))

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="block h-auto w-full select-none"
      role="img"
      aria-label="Spinning wheel"
      style={{
        transform: `scale(${zoom})`,
        // zoom toward the pointer at the top — that's where the pick happens
        transformOrigin: '50% 10%',
        // rAF drives the zoom-in; the ease-out back to rest is CSS
        transition: spinning ? 'none' : 'transform 800ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <defs>
        <linearGradient id="gold-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f2c178" />
          <stop offset="100%" stopColor="#b87f2e" />
        </linearGradient>
        <radialGradient id="wheel-shade" cx="50%" cy="50%" r="50%">
          <stop offset="62%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.42)" />
        </radialGradient>
        <radialGradient id="hub-grad" cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#f6d496" />
          <stop offset="55%" stopColor="#d99a3d" />
          <stop offset="100%" stopColor="#8f6224" />
        </radialGradient>
        {/* diagonal ticker-tape stripes mark catalog slices (live TMDB source) */}
        <pattern
          id="catalog-stripes"
          patternUnits="userSpaceOnUse"
          width="13"
          height="13"
          patternTransform="rotate(45)"
        >
          <rect width="6.5" height="13" fill="rgba(242,193,120,0.13)" />
        </pattern>
      </defs>

      {/* bezel */}
      <circle cx={C} cy={C} r={R + BEZEL} fill="#241b12" stroke="#3a2c1b" strokeWidth="2" />
      <circle cx={C} cy={C} r={R + 3} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="6" />

      {/* brass studs on the bezel */}
      {Array.from({ length: BULBS }, (_, i) => {
        const p = polar((i * 360) / BULBS - 90, R + BEZEL / 2 + 1)
        return <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#a9853f" opacity={0.8} />
      })}

      {/* rotating face */}
      <g transform={`rotate(${rot % 360} ${C} ${C})`}>
        {n === 1 ? (
          <circle cx={C} cy={C} r={R} fill={sliceColor(0, 1)} />
        ) : (
          slices.map((s, i) => {
            const a0 = -90 + i * seg
            const a1 = a0 + seg
            const dimmed = settled != null && settled !== i
            const d = arcPath(a0, a1, R)
            return (
              <g
                key={s.id}
                className="slice-in"
                opacity={dimmed ? 0.4 : 1}
                style={{ transition: 'opacity 500ms ease' }}
              >
                <path
                  d={d}
                  fill={sliceColor(i, n)}
                  stroke={settled === i ? '#f2c178' : 'rgba(18,14,12,0.6)'}
                  strokeWidth={settled === i ? 4 : 1.5}
                />
                {s.catalog && <path d={d} fill="url(#catalog-stripes)" pointerEvents="none" />}
              </g>
            )
          })
        )}

        {slices.map((s, i) => {
          const mid = -90 + (i + 0.5) * seg
          const label =
            s.label.length > maxChars ? s.label.slice(0, maxChars - 1).trimEnd() + '…' : s.label
          const dimmed = settled != null && settled !== i
          return (
            <g
              key={s.id}
              transform={`rotate(${mid} ${C} ${C})`}
              opacity={dimmed ? 0.4 : 1}
              style={{ transition: 'opacity 500ms ease' }}
            >
              <text
                x={C + labelEnd}
                y={s.sublabel && showSublabels ? C - 4 : C}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#f0e6d2"
                fontSize={fontSize}
                fontWeight={650}
                fontFamily="Archivo, ui-sans-serif, sans-serif"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.35)', strokeWidth: 2.5 }}
              >
                {label}
              </text>
              {s.sublabel && showSublabels && (
                <text
                  x={C + labelEnd}
                  y={C + fontSize - 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="rgba(240,230,210,0.6)"
                  fontSize={fontSize * 0.66}
                  fontFamily="Archivo, ui-sans-serif, sans-serif"
                >
                  {s.sublabel}
                </text>
              )}
            </g>
          )
        })}
      </g>

      {/* inner shading */}
      <circle cx={C} cy={C} r={R} fill="url(#wheel-shade)" pointerEvents="none" />

      {/* hub: film reel */}
      <circle cx={C} cy={C} r={52} fill="url(#hub-grad)" stroke="#5c3f17" strokeWidth="2" />
      <circle cx={C} cy={C} r={40} fill="#241b12" />
      {Array.from({ length: 6 }, (_, i) => {
        const p = polar(i * 60 - 90 + (rot % 360), 26)
        return <circle key={i} cx={p.x} cy={p.y} r={6.5} fill="url(#hub-grad)" opacity={0.9} />
      })}
      <circle cx={C} cy={C} r={9} fill="url(#hub-grad)" />

      {/* pointer */}
      <g style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.6))' }}>
        <polygon
          points={`${C - 17},${C - R - BEZEL - 8} ${C + 17},${C - R - BEZEL - 8} ${C},${C - R + 18}`}
          fill="url(#gold-grad)"
          stroke="#5c3f17"
          strokeWidth="1.5"
          className={spinning ? 'origin-center' : ''}
        />
        <circle cx={C} cy={C - R - BEZEL - 2} r={5} fill="#f6d496" />
      </g>
    </svg>
  )
}
