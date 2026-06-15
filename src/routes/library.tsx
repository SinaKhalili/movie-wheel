import { useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Dices, ListOrdered, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { LISTS, SERVICES, SHIPPED_FILMS } from '../lib/films'
import { movieDetails, searchMovies, type TmdbSearchResult } from '../lib/api'
import { SLICES_KEY, useFilmLibrary, usePersisted, useRegion, useSnapshotAge } from '../lib/store'
import { DEFAULT_SLICES } from '../lib/defaults'
import { mergeAllLists } from '../lib/lists'
import type { Slice } from '../lib/types'
import { uid } from '../lib/types'

export const Route = createFileRoute('/library')({ component: LibraryPage })

const REGIONS: Array<[string, string]> = [
  ['CA', 'Canada'],
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['AU', 'Australia'],
  ['NZ', 'New Zealand'],
  ['IE', 'Ireland'],
  ['FR', 'France'],
  ['DE', 'Germany'],
  ['NL', 'Netherlands'],
  ['SE', 'Sweden'],
  ['NO', 'Norway'],
  ['DK', 'Denmark'],
  ['IT', 'Italy'],
  ['ES', 'Spain'],
  ['PT', 'Portugal'],
  ['JP', 'Japan'],
  ['KR', 'South Korea'],
  ['BR', 'Brazil'],
  ['MX', 'Mexico'],
  ['IN', 'India'],
]

type Draft = {
  id: string | null
  title: string
  year: string
  director: string
  country: string
  services: string[]
  lists: string[]
  tmdbId?: number
  poster?: string
}

const EMPTY_DRAFT: Draft = {
  id: null,
  title: '',
  year: '',
  director: '',
  country: '',
  services: [],
  lists: [],
}

type SyncState = { stage: 'idle' } | { stage: 'done'; message: string }

export function FreshnessNote() {
  const days = useSnapshotAge()
  if (days == null) return null
  const label = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  const stale = days > 21
  return (
    <span className={stale ? 'text-[#c9925a]' : undefined}>
      Streaming availability snapshot built {label}.
    </span>
  )
}

function LibraryPage() {
  const [films, setFilms, hydrated] = useFilmLibrary()
  const [slices, setSlices] = usePersisted<Slice[]>(SLICES_KEY, DEFAULT_SLICES)
  const [region, setRegion] = useRegion()
  const [view, setView] = useState<'films' | 'directors'>('films')
  const [query, setQuery] = useState('')
  const [serviceFilter, setServiceFilter] = useState<string | null>(null)
  const [listFilter, setListFilter] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sync, setSync] = useState<SyncState>({ stage: 'idle' })

  const directors = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of films) {
      if (f.director && f.director !== 'Unknown') {
        counts.set(f.director, (counts.get(f.director) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [films])

  const visibleDirectors = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? directors.filter(([name]) => name.toLowerCase().includes(q)) : directors
  }, [directors, query])

  const directorOnWheel = (name: string) =>
    slices.some(
      (s) =>
        s.type === 'filter' &&
        s.conditions.some((c) => c.kind === 'director' && c.directors.length === 1 && c.directors[0] === name),
    )

  const addDirectorSlice = (name: string) => {
    if (directorOnWheel(name)) return
    setSlices((prev) => [
      ...prev,
      { id: uid(), type: 'filter', label: name, conditions: [{ kind: 'director', directors: [name] }] },
    ])
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return films
      .filter(
        (f) =>
          (!q || f.title.toLowerCase().includes(q) || f.director.toLowerCase().includes(q)) &&
          (!serviceFilter || f.services.includes(serviceFilter)) &&
          (!listFilter || f.lists.includes(listFilter)),
      )
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [films, query, serviceFilter, listFilter])

  // the full library is ~20k films — don't render more rows than that at once
  const ROW_CAP = 250
  const shown = visible.length > ROW_CAP ? visible.slice(0, ROW_CAP) : visible

  const toggleTag = (filmId: string, field: 'services' | 'lists', tag: string) =>
    setFilms((prev) =>
      prev.map((f) =>
        f.id === filmId
          ? {
              ...f,
              [field]: f[field].includes(tag)
                ? f[field].filter((t) => t !== tag)
                : [...f[field], tag],
            }
          : f,
      ),
    )

  const syncLists = () => {
    const { films: next, summary } = mergeAllLists(films)
    setFilms(next)
    const added = Object.values(summary).reduce((n, s) => n + s.added, 0)
    setSync({
      stage: 'done',
      message: `Lists synced: ${added} films added (TSPDT ${summary.tspdt.added}, Criterion ${summary.criterion.added}, S&S ${summary.ss2022.added}, AFI ${summary.afi.added}, Bottom 200 ${summary.worst200.added}).`,
    })
  }

  const saveDraft = () => {
    if (!draft || !draft.title.trim()) return
    const year = Number(draft.year) || new Date().getFullYear()
    const fields = {
      title: draft.title.trim(),
      year,
      director: draft.director.trim() || 'Unknown',
      country: draft.country.trim() || 'Unknown',
      services: draft.services,
      lists: draft.lists,
      tmdbId: draft.tmdbId,
      poster: draft.poster,
    }
    if (draft.id) {
      setFilms((prev) => prev.map((f) => (f.id === draft.id ? { ...f, ...fields } : f)))
    } else {
      const id = `${draft.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-${year}-${Math.random().toString(36).slice(2, 6)}`
      setFilms((prev) => [...prev, { id, ...fields }])
    }
    setDraft(null)
  }

  const toggleDraftTag = (field: 'services' | 'lists', tag: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            [field]: d[field].includes(tag)
              ? d[field].filter((t) => t !== tag)
              : [...d[field], tag],
          }
        : d,
    )

  const busy = false

  return (
    <main className="mx-auto w-[min(1240px,calc(100%-2rem))] pb-16 pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="marquee-font m-0 text-3xl tracking-wide text-[var(--gold-bright)]">
            The Library
          </h1>
          <p className="mb-0 mt-1 max-w-xl text-sm text-[var(--ink-dim)]">
            {films.length} films.{' '}
            <FreshnessNote />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--ink-dim)]">
            Region
            <select
              className="field !w-auto !py-2"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={busy}
            >
              {(REGIONS.some(([c]) => c === region) ? REGIONS : [[region, region] as [string, string], ...REGIONS]).map(
                ([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ),
              )}
            </select>
          </label>
          <button className="btn" onClick={syncLists} disabled={busy || !hydrated} title="Merge TSPDT 1,000, Sight & Sound 250, Criterion Collection, and AFI 100 into your library">
            <ListOrdered size={14} /> Sync canon lists
          </button>
          <button className="btn btn-solid" onClick={() => setDraft({ ...EMPTY_DRAFT })} disabled={busy}>
            <Plus size={14} /> Add film
          </button>
          <button
            className="btn-ghost btn"
            title="Restore the seeded library (discards your edits)"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Replace your library with the shipped snapshot? Your edits will be lost.'))
                setFilms(SHIPPED_FILMS)
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>


      {sync.stage === 'done' && (
        <div className="card mb-5 flex items-center justify-between gap-4 p-4">
          <p className="m-0 text-sm text-[var(--ink)]">{sync.message}</p>
          <button className="btn-ghost btn !p-1.5" onClick={() => setSync({ stage: 'idle' })} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-[var(--line)]">
          <button
            className={`px-3 py-2 text-sm font-semibold transition-colors ${view === 'films' ? 'bg-[rgba(217,154,61,0.18)] text-[var(--gold-bright)]' : 'text-[var(--ink-dim)] hover:text-[var(--ink)]'}`}
            onClick={() => setView('films')}
          >
            Films
          </button>
          <button
            className={`px-3 py-2 text-sm font-semibold transition-colors ${view === 'directors' ? 'bg-[rgba(217,154,61,0.18)] text-[var(--gold-bright)]' : 'text-[var(--ink-dim)] hover:text-[var(--ink)]'}`}
            onClick={() => setView('directors')}
          >
            Directors
          </button>
        </div>
        <input
          className="field max-w-xs"
          placeholder={view === 'films' ? 'Search title or director…' : 'Search directors…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {view === 'films' && (
          <>
            {SERVICES.map((s) => (
              <button
                key={s.id}
                className={`chip ${serviceFilter === s.id ? 'is-on' : ''}`}
                onClick={() => setServiceFilter(serviceFilter === s.id ? null : s.id)}
              >
                {s.name}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[var(--line)]" />
            {LISTS.map((l) => (
              <button
                key={l.id}
                className={`chip ${listFilter === l.id ? 'is-on' : ''}`}
                onClick={() => setListFilter(listFilter === l.id ? null : l.id)}
              >
                {l.name}
              </button>
            ))}
          </>
        )}
        {view === 'directors' && (
          <span className="text-sm text-[var(--ink-dim)]">
            {directors.length} directors — add one to the wheel and spin for a random film of theirs
          </span>
        )}
      </div>

      {draft && (
        <DraftForm
          draft={draft}
          setDraft={setDraft}
          onSave={saveDraft}
          onToggleTag={toggleDraftTag}
        />
      )}

      {view === 'directors' && (
        <div className="card overflow-hidden">
          <ul className="m-0 grid list-none gap-px p-0 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDirectors.map(([name, count]) => {
              const onWheel = directorOnWheel(name)
              return (
                <li
                  key={name}
                  className="group flex items-center gap-2 px-4 py-2.5 transition-colors hover:bg-black/20"
                >
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium text-[var(--ink)] hover:text-[var(--gold-bright)]"
                    title={`Show ${name}'s films`}
                    onClick={() => {
                      setView('films')
                      setQuery(name)
                    }}
                  >
                    {name}
                    <span className="ml-2 text-xs font-normal text-[var(--ink-faint)]">{count}</span>
                  </button>
                  <button
                    className={`btn !px-2 !py-1.5 !text-xs ${onWheel ? 'opacity-60' : 'opacity-0 group-hover:opacity-100'}`}
                    disabled={onWheel}
                    title={onWheel ? 'Already on the wheel' : `Add a ${name} slice to the wheel`}
                    onClick={() => addDirectorSlice(name)}
                  >
                    <Dices size={13} /> {onWheel ? 'On wheel' : 'Wheel'}
                  </button>
                </li>
              )
            })}
            {hydrated && visibleDirectors.length === 0 && (
              <li className="col-span-full px-4 py-10 text-center text-[var(--ink-dim)]">
                No directors match that search.
              </li>
            )}
          </ul>
        </div>
      )}

      {view === 'films' && (
      <div className="card overflow-hidden">
        <ul className="m-0 list-none divide-y divide-[rgba(217,154,61,0.08)] p-0">
          {shown.map((film) => (
            <li
              key={film.id}
              className="grid items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-black/20 sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_auto]"
            >
              <div className="min-w-0">
                <span className="font-semibold text-[var(--ink)]">{film.title}</span>{' '}
                <span className="text-sm text-[var(--ink-dim)]">({film.year})</span>
                {film.tspdtRank != null && (
                  <span className="ml-2 rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[0.65rem] font-bold text-[var(--gold)]">
                    TSPDT #{film.tspdtRank}
                  </span>
                )}
                <div className="truncate text-sm text-[var(--ink-dim)]">
                  {film.director} · {film.country}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SERVICES.map((s) => (
                  <button
                    key={s.id}
                    className={`chip ${film.services.includes(s.id) ? 'is-on' : ''}`}
                    onClick={() => toggleTag(film.id, 'services', s.id)}
                    title={`Toggle ${s.name}`}
                  >
                    {s.name}
                  </button>
                ))}
                {LISTS.filter((l) => film.lists.includes(l.id)).map((l) => (
                  <button
                    key={l.id}
                    className="chip"
                    onClick={() => toggleTag(film.id, 'lists', l.id)}
                    title={`Remove from ${l.name}`}
                  >
                    {l.name} <X size={10} />
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-1">
                <button
                  className="btn-ghost btn !p-2"
                  aria-label={`Edit ${film.title}`}
                  onClick={() =>
                    setDraft({
                      id: film.id,
                      title: film.title,
                      year: String(film.year),
                      director: film.director,
                      country: film.country,
                      services: [...film.services],
                      lists: [...film.lists],
                      tmdbId: film.tmdbId,
                      poster: film.poster,
                    })
                  }
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="btn-ghost btn !p-2 hover:!text-[#c96a5a]"
                  aria-label={`Delete ${film.title}`}
                  onClick={() => setFilms((prev) => prev.filter((f) => f.id !== film.id))}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
          {visible.length > shown.length && (
            <li className="px-4 py-3 text-center text-sm text-[var(--ink-dim)]">
              Showing {shown.length} of {visible.length.toLocaleString()} films — search or filter
              to narrow down.
            </li>
          )}
          {hydrated && visible.length === 0 && (
            <li className="px-4 py-10 text-center text-[var(--ink-dim)]">
              No films match that search.
            </li>
          )}
        </ul>
      </div>
      )}
    </main>
  )
}

function DraftForm({
  draft,
  setDraft,
  onSave,
  onToggleTag,
}: {
  draft: Draft
  setDraft: (d: Draft | null) => void
  onSave: () => void
  onToggleTag: (field: 'services' | 'lists', tag: string) => void
}) {
  const [tmdbQuery, setTmdbQuery] = useState('')
  const [results, setResults] = useState<TmdbSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)

  const runSearch = async (q: string) => {
    setTmdbQuery(q)
    const seq = ++searchSeq.current
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const r = await searchMovies({ data: { query: q } })
      if (seq === searchSeq.current) setResults(r)
    } catch {
      if (seq === searchSeq.current) setResults([])
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }

  const pick = async (r: TmdbSearchResult) => {
    setResults([])
    setTmdbQuery('')
    // fill what we have immediately; enrich with credits
    setDraft({
      ...draft,
      title: r.title,
      year: r.year ? String(r.year) : draft.year,
      tmdbId: r.tmdbId,
      poster: r.poster ?? undefined,
    })
    try {
      const d = await movieDetails({ data: { tmdbId: r.tmdbId } })
      setDraft({
        ...draft,
        title: d.title,
        year: d.year ? String(d.year) : draft.year,
        director: d.director,
        country: d.country,
        tmdbId: d.tmdbId,
        poster: d.poster ?? undefined,
      })
    } catch {
      // keep the partial fill
    }
  }

  return (
    <div className="card mb-6 p-5">
      <h2 className="marquee-font mb-4 mt-0 text-lg text-[var(--ink)]">
        {draft.id ? 'Edit film' : 'New film'}
      </h2>

      {!draft.id && (
        <div className="relative mb-4">
          <div className="flex items-center gap-2">
            <Search size={15} className="text-[var(--ink-faint)]" />
            <input
              className="field"
              placeholder="Search TMDB — fills everything in for you…"
              value={tmdbQuery}
              onChange={(e) => void runSearch(e.target.value)}
              autoFocus
            />
          </div>
          {(results.length > 0 || searching) && (
            <ul className="card absolute z-10 m-0 mt-2 max-h-72 w-full list-none overflow-y-auto p-1">
              {searching && results.length === 0 && (
                <li className="px-3 py-2 text-sm text-[var(--ink-dim)]">Searching…</li>
              )}
              {results.map((r) => (
                <li key={r.tmdbId}>
                  <button
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[rgba(217,154,61,0.12)]"
                    onClick={() => void pick(r)}
                  >
                    {r.poster ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w92${r.poster}`}
                        alt=""
                        className="h-12 w-8 flex-shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="h-12 w-8 flex-shrink-0 rounded bg-black/40" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-[var(--ink)]">
                        {r.title} {r.year ? <span className="text-[var(--ink-dim)]">({r.year})</span> : null}
                      </span>
                      <span className="block truncate text-xs text-[var(--ink-faint)]">
                        {r.overview}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[2fr_5rem_1.5fr_1fr]">
        <input
          className="field"
          placeholder="Title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <input
          className="field"
          placeholder="Year"
          type="number"
          value={draft.year}
          onChange={(e) => setDraft({ ...draft, year: e.target.value })}
        />
        <input
          className="field"
          placeholder="Director"
          value={draft.director}
          onChange={(e) => setDraft({ ...draft, director: e.target.value })}
        />
        <input
          className="field"
          placeholder="Country"
          value={draft.country}
          onChange={(e) => setDraft({ ...draft, country: e.target.value })}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="kicker mr-1">Streaming</span>
        {SERVICES.map((s) => (
          <button
            key={s.id}
            className={`chip ${draft.services.includes(s.id) ? 'is-on' : ''}`}
            onClick={() => onToggleTag('services', s.id)}
          >
            {s.name}
          </button>
        ))}
        <span className="kicker ml-3 mr-1">Lists</span>
        {LISTS.map((l) => (
          <button
            key={l.id}
            className={`chip ${draft.lists.includes(l.id) ? 'is-on' : ''}`}
            onClick={() => onToggleTag('lists', l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-solid" onClick={onSave} disabled={!draft.title.trim()}>
          {draft.id ? 'Save changes' : 'Add to library'}
        </button>
        <button className="btn-ghost btn" onClick={() => setDraft(null)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
