import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CornerDownRight, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import Wheel, { playTick, type SpinCommand, type WheelSliceView } from '../components/Wheel'
import WheelEditor from '../components/WheelEditor'
import { listName, serviceName } from '../lib/films'
import { catalogSample, movieDetails } from '../lib/api'
import { matchFilms } from '../lib/filter'
import { MUTED_KEY, SLICES_KEY, useFilmLibrary, usePersisted, useRegion, useSnapshotAge } from '../lib/store'
import type { Film, Slice } from '../lib/types'
import { DEFAULT_SLICES } from '../lib/defaults'

export const Route = createFileRoute('/')({ component: SpinPage })

const SUBWHEEL_MAX = 30

type RSlice =
  | { kind: 'film'; id: string; label: string; sublabel?: string; film: Film }
  | { kind: 'text'; id: string; label: string }
  | { kind: 'group'; id: string; label: string; sublabel: string; films: Film[] }
  | {
      kind: 'catalog'
      id: string
      label: string
      sublabel: string
      services: string[]
      yearFrom?: number
      yearTo?: number
    }

type Frame = { title: string; slices: RSlice[] }

type Winner =
  | { kind: 'film'; film: Film; path: string[] }
  | { kind: 'text'; text: string; path: string[] }
  | { kind: 'empty'; label: string; path: string[] }

function filmSlice(film: Film): RSlice {
  return {
    kind: 'film',
    id: film.id,
    label: film.title,
    sublabel: `${film.year}`,
    film,
  }
}

/**
 * Turn a pool of films into a wheel. Oversized pools are split into
 * chronological buckets labeled by year span ("1970–1975") so the subwheel
 * slices mean something.
 */
function frameFromFilms(title: string, films: Film[]): Frame {
  if (films.length <= SUBWHEEL_MAX) {
    return { title, slices: films.map(filmSlice) }
  }
  const pool = [...films].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title))
  const buckets = Math.min(SUBWHEEL_MAX, Math.ceil(pool.length / SUBWHEEL_MAX))
  const size = Math.ceil(pool.length / buckets)
  const slices: RSlice[] = []
  const labelCounts = new Map<string, number>()
  for (let i = 0; i < buckets; i++) {
    const chunk = pool.slice(i * size, (i + 1) * size)
    if (chunk.length === 0) continue
    const from = chunk[0].year
    const to = chunk[chunk.length - 1].year
    let label = from === to ? `${from}` : `${from}–${to}`
    // dense same-year pools can produce identical spans — number them
    const seen = (labelCounts.get(label) ?? 0) + 1
    labelCounts.set(label, seen)
    if (seen > 1) label = `${label} · ${seen}`
    slices.push({
      kind: 'group',
      id: `bucket-${i}`,
      label,
      sublabel: `${chunk.length} films`,
      films: chunk,
    })
  }
  return { title, slices }
}

function buildRootFrame(slices: Slice[], films: Film[]): Frame {
  const rslices: RSlice[] = []
  for (const s of slices) {
    if (s.muted) continue
    if (s.type === 'film') {
      const film = films.find((f) => f.id === s.filmId)
      if (film) rslices.push(filmSlice(film))
    } else if (s.type === 'text') {
      rslices.push({ kind: 'text', id: s.id, label: s.text })
    } else if (s.scope === 'catalog') {
      const services = s.conditions.flatMap((c) => (c.kind === 'service' ? c.services : []))
      const yearCond = s.conditions.find((c) => c.kind === 'year')
      rslices.push({
        kind: 'catalog',
        id: s.id,
        label: s.label,
        sublabel: 'whole catalog',
        services,
        yearFrom: yearCond?.kind === 'year' ? yearCond.from : undefined,
        yearTo: yearCond?.kind === 'year' ? yearCond.to : undefined,
      })
    } else {
      const matched = matchFilms(films, s.conditions)
      rslices.push({
        kind: 'group',
        id: s.id,
        label: s.label,
        sublabel: `${matched.length} films`,
        films: matched,
      })
    }
  }
  return { title: 'Main wheel', slices: rslices }
}

function SpinPage() {
  const [films, setFilms] = useFilmLibrary()
  const [slices, setSlices, hydrated] = usePersisted<Slice[]>(SLICES_KEY, DEFAULT_SLICES)
  const [muted, setMuted] = usePersisted<boolean>(MUTED_KEY, false)
  const [region] = useRegion()
  const staleDays = useSnapshotAge() ?? 0

  // Merge AI-grounded films into the library, unioning list tags on collisions.
  const addFilms = (incoming: Film[]) => {
    setFilms((prev) => {
      const byId = new Map(prev.map((f) => [f.id, f]))
      for (const f of incoming) {
        const cur = byId.get(f.id)
        byId.set(f.id, cur ? { ...cur, lists: [...new Set([...cur.lists, ...f.lists])] } : f)
      }
      return [...byId.values()]
    })
  }

  const rootFrame = useMemo(() => buildRootFrame(slices, films), [slices, films])
  const [subFrames, setSubFrames] = useState<Frame[]>([])
  const [path, setPath] = useState<string[]>([])
  const [command, setCommand] = useState<SpinCommand | null>(null)
  const [busy, setBusy] = useState(false)
  const [zapping, setZapping] = useState(false)
  const [winner, setWinner] = useState<Winner | null>(null)
  const seq = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms))

  const frames = subFrames.length ? subFrames : [rootFrame]
  const frame = frames[frames.length - 1]

  const spinFrame = (target: Frame) => {
    if (target.slices.length === 0) return
    setBusy(true)
    seq.current += 1
    setCommand({ seq: seq.current, index: Math.floor(Math.random() * target.slices.length) })
  }

  const startSpin = () => {
    setWinner(null)
    setPath([])
    setSubFrames([])
    setCommand(null)
    // let the root wheel remount before commanding it
    later(() => spinFrame(rootFrame), 50)
  }

  /** Rewind to a wheel earlier in the cascade and respin just that portion. */
  const respinFrom = (level: number) => {
    if (busy) return
    if (level === 0) {
      startSpin()
      return
    }
    const kept = frames.slice(0, level + 1)
    setWinner(null)
    setSubFrames(kept)
    setPath((p) => p.slice(0, level))
    setCommand(null)
    later(() => spinFrame(kept[level]), 80)
  }

  const crownFilm = (film: Film, winPath: string[]) => {
    setWinner({ kind: 'film', film, path: winPath })
    setBusy(false)
    // catalog films arrive without credits — enrich the marquee card
    if (!film.director && film.tmdbId) {
      movieDetails({ data: { tmdbId: film.tmdbId } })
        .then((d) =>
          setWinner((w) =>
            w?.kind === 'film' && w.film.tmdbId === film.tmdbId
              ? { ...w, film: { ...w.film, director: d.director, country: d.country } }
              : w,
          ),
        )
        .catch(() => {})
    }
  }

  const handleSettle = (index: number) => {
    const landed = frame.slices[index]
    if (!landed) return

    if (landed.kind === 'film') {
      later(() => crownFilm(landed.film, path), 900)
      return
    }
    if (landed.kind === 'text') {
      later(() => {
        setWinner({ kind: 'text', text: landed.label, path })
        setBusy(false)
      }, 900)
      return
    }

    if (landed.kind === 'catalog') {
      const nextPath = [...path, landed.label]
      void catalogSample({
        data: {
          services: landed.services,
          region,
          yearFrom: landed.yearFrom,
          yearTo: landed.yearTo,
          count: 30,
        },
      })
        .then((sample) => {
          if (sample.films.length === 0) {
            later(() => {
              setWinner({ kind: 'empty', label: landed.label, path: nextPath })
              setBusy(false)
            }, 600)
            return
          }
          const pool: Film[] = sample.films.map((m) => ({
            id: `tmdb-${m.tmdbId}`,
            title: m.title,
            year: m.year ?? 0,
            director: '',
            country: '',
            services: landed.services,
            lists: [],
            tmdbId: m.tmdbId,
            poster: m.poster ?? undefined,
          }))
          const allSlices = pool.map(filmSlice)
          const full: Frame = { title: landed.label, slices: allSlices }
          // zap the sampled films onto the wheel one at a time — they really
          // were just drawn at random from the live catalog
          const ZAP_MS = 140
          later(() => {
            setPath(nextPath)
            setCommand(null)
            setZapping(true)
            setSubFrames((prev) => [
              ...(prev.length ? prev : [rootFrame]),
              { title: landed.label, slices: allSlices.slice(0, 1) },
            ])
            if (!muted) playTick()
            for (let k = 2; k <= allSlices.length; k++) {
              const upto = k
              later(() => {
                setSubFrames((prev) => {
                  const copy = [...prev]
                  copy[copy.length - 1] = { title: landed.label, slices: allSlices.slice(0, upto) }
                  return copy
                })
                if (!muted) playTick()
              }, (upto - 1) * ZAP_MS)
            }
            later(() => {
              setZapping(false)
              spinFrame(full)
            }, allSlices.length * ZAP_MS + 700)
          }, 700)
        })
        .catch(() => {
          later(() => {
            setWinner({ kind: 'empty', label: `${landed.label} (catalog lookup failed)`, path: nextPath })
            setBusy(false)
          }, 600)
        })
      return
    }

    // group: cascade into a subwheel
    const nextPath = [...path, landed.label]
    if (landed.films.length === 0) {
      later(() => {
        setWinner({ kind: 'empty', label: landed.label, path: nextPath })
        setBusy(false)
      }, 900)
      return
    }
    if (landed.films.length === 1) {
      later(() => {
        setWinner({ kind: 'film', film: landed.films[0], path: nextPath })
        setBusy(false)
      }, 900)
      return
    }
    const next = frameFromFilms(landed.label, landed.films)
    later(() => {
      setPath(nextPath)
      setCommand(null)
      setSubFrames((prev) => [...(prev.length ? prev : [rootFrame]), next])
      later(() => spinFrame(next), 1100)
    }, 1000)
  }

  const trail = ['Main wheel', ...path]
  const wheelSlices: WheelSliceView[] = frame.slices.map((s) => ({
    id: s.id,
    label: s.label,
    sublabel: 'sublabel' in s ? s.sublabel : undefined,
    catalog: s.kind === 'catalog',
  }))

  return (
    <main className="mx-auto w-[min(1240px,calc(100%-2rem))] pb-16 pt-5">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* stage */}
        <section className="relative flex min-w-0 flex-col items-center">
          {/* trail */}
          <div className="mb-4 flex min-h-[2rem] w-full max-w-full flex-wrap items-center justify-center gap-2">
            {trail.map((t, i) => (
              <span key={`${t}-${i}`} className="flex items-center gap-2">
                {i > 0 && <CornerDownRight size={14} className="text-[var(--gold)]" />}
                <button
                  className={`chip ${i === trail.length - 1 ? 'is-on' : ''} marquee-pop`}
                  disabled={busy}
                  title={`Respin from ${t}`}
                  onClick={() => respinFrom(i)}
                >
                  {t}
                </button>
              </span>
            ))}
          </div>

          <div className="relative w-full max-w-[540px] lg:max-w-[620px] xl:max-w-[720px]">
            <div
              className="pointer-events-none absolute -inset-10 -z-10 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(242,193,120,0.12), rgba(242,193,120,0.03) 55%, transparent 72%)',
              }}
            />
            <Wheel
              key={`${frames.length}-${frame.title}`}
              slices={wheelSlices}
              command={command}
              muted={muted}
              onSettle={handleSettle}
            />
            <button
              className="cursor-reel absolute left-1/2 top-1/2 z-10 aspect-square w-[16%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-bright)]"
              onClick={startSpin}
              disabled={busy || !hydrated || rootFrame.slices.length === 0}
              aria-label="Spin the wheel"
              title="Spin"
            />
            {zapping && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <span className="marquee-pop animate-pulse rounded-full border border-[var(--line-strong)] bg-black/85 px-4 py-2 text-sm font-semibold text-[var(--gold-bright)] shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
                  adding random movies…
                </span>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              className="btn btn-solid marquee-font cursor-reel !rounded-full !px-10 !py-4 !text-xl tracking-[0.03em]"
              onClick={startSpin}
              disabled={busy || !hydrated || rootFrame.slices.length === 0}
            >
              {busy ? 'Spinning…' : 'Spin'}
            </button>
            <button
              className="btn-ghost btn !rounded-full !p-3"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            {subFrames.length > 0 && !busy && (
              <button
                className="btn-ghost btn !rounded-full !p-3"
                onClick={() => {
                  setSubFrames([])
                  setPath([])
                  setCommand(null)
                }}
                aria-label="Back to main wheel"
                title="Back to main wheel"
              >
                <RotateCcw size={18} />
              </button>
            )}
          </div>

          {staleDays > 21 && (
            <p className="mb-0 mt-3 text-xs text-[#c9925a]">
              Streaming data is {staleDays} days old — refresh it on the{' '}
              <Link to="/library" className="underline">
                Library
              </Link>{' '}
              page so the wheel doesn’t lie to you.
            </p>
          )}
        </section>

        {/* lineup editor */}
        <WheelEditor
          slices={slices}
          films={films}
          region={region}
          onChange={setSlices}
          onAddFilms={addFilms}
          disabled={busy}
        />
      </div>

      {winner && (
        <WinnerMarquee
          winner={winner}
          onClose={() => setWinner(null)}
          onRespin={startSpin}
        />
      )}
    </main>
  )
}

function WinnerMarquee({
  winner,
  onClose,
  onRespin,
}: {
  winner: Winner
  onClose: () => void
  onRespin: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card marquee-pop w-full max-w-lg !border-[var(--line-strong)] p-8 text-center"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Spin result"
      >
        {winner.kind === 'empty' ? (
          <>
            <div className="deco-rule mb-5">
              <span className="kicker">House lights up</span>
            </div>
            <h2 className="marquee-font mb-3 mt-0 text-3xl text-[var(--ink)]">
              “{winner.label}” matches nothing
            </h2>
            <p className="mb-0 text-sm text-[var(--ink-dim)]">
              Loosen the conditions, or tag more films on the{' '}
              <Link to="/library" className="underline">
                Library
              </Link>{' '}
              page.
            </p>
          </>
        ) : (
          <>
            <div className="deco-rule mb-5">
              <span className="kicker">Tonight’s picture</span>
            </div>
            {winner.kind === 'film' && winner.film.poster && (
              <img
                src={`https://image.tmdb.org/t/p/w342${winner.film.poster}`}
                alt={`${winner.film.title} poster`}
                className="mx-auto mb-4 w-36 rounded-lg border border-[var(--line-strong)] shadow-[0_18px_40px_rgba(0,0,0,0.6)]"
              />
            )}
            <h2 className="marquee-font mb-2 mt-0 text-4xl leading-tight text-[var(--gold-bright)]">
              {winner.kind === 'film' ? winner.film.title : winner.text}
            </h2>
            {winner.kind === 'film' && (
              <>
                <p className="mb-3 mt-0 text-[var(--ink-dim)]">
                  {[winner.film.director, winner.film.year || null, winner.film.country]
                    .filter(Boolean)
                    .join(' · ')}
                  {winner.film.tspdtRank != null && ` · TSPDT #${winner.film.tspdtRank}`}
                </p>
                {(() => {
                  // hide internal AI grouping tags (ai:<id>) — they aren't canon lists
                  const lists = winner.film.lists.filter((l) => !l.startsWith('ai:'))
                  if (winner.film.services.length === 0 && lists.length === 0) return null
                  return (
                    <div className="mb-1 flex flex-wrap justify-center gap-1.5">
                      {winner.film.services.map((s) => (
                        <span key={s} className="chip is-on chip-static">
                          {serviceName(s)}
                        </span>
                      ))}
                      {lists.map((l) => (
                        <span key={l} className="chip chip-static">
                          {listName(l)}
                        </span>
                      ))}
                    </div>
                  )
                })()}
              </>
            )}
          </>
        )}

        {winner.path.length > 0 && (
          <p className="mb-0 mt-4 text-xs text-[var(--ink-faint)]">
            via {['Main wheel', ...winner.path].join(' → ')}
          </p>
        )}

        <div className="deco-rule my-5">
          <span className="text-xs">✦</span>
        </div>

        <div className="flex justify-center gap-3">
          <button className="btn" onClick={onRespin}>
            <RotateCcw size={14} /> Spin again
          </button>
          <button className="btn btn-solid" onClick={onClose}>
            That’s the one
          </button>
        </div>
      </div>
    </div>
  )
}
