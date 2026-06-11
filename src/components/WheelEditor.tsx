import { Fragment, useMemo, useState } from 'react'
import { Eye, EyeOff, Film as FilmIcon, Pencil, Plus, SlidersHorizontal, Type, X } from 'lucide-react'
import type { Condition, ConditionKind, Film, Slice } from '../lib/types'
import { uid } from '../lib/types'
import { LISTS, SERVICES, distinctCountries, distinctDirectors } from '../lib/films'
import { conditionSummary, matchFilms } from '../lib/filter'
import Typeahead from './Typeahead'
import { sliceColor } from './Wheel'

type Mode =
  | { kind: 'closed' }
  | { kind: 'film' }
  | { kind: 'text' }
  | {
      kind: 'filter'
      editingId: string | null
      label: string
      conditions: Condition[]
      scope: 'library' | 'catalog'
    }

const CATALOG_KINDS: ConditionKind[] = ['service', 'year']

function emptyCondition(kind: ConditionKind): Condition {
  switch (kind) {
    case 'director':
      return { kind, directors: [] }
    case 'year':
      return { kind, from: 1960, to: 1979 }
    case 'country':
      return { kind, countries: [] }
    case 'service':
      return { kind, services: [] }
    case 'list':
      return { kind, lists: [] }
    case 'rank':
      return { kind, max: 100 }
  }
}

function sliceLabel(slice: Slice, films: Film[]): string {
  switch (slice.type) {
    case 'film': {
      const film = films.find((f) => f.id === slice.filmId)
      return film ? `${film.title} (${film.year})` : 'Missing film'
    }
    case 'text':
      return slice.text
    case 'filter':
      return slice.label
  }
}

export default function WheelEditor({
  slices,
  films,
  onChange,
  disabled,
}: {
  slices: Slice[]
  films: Film[]
  onChange: (next: Slice[]) => void
  disabled: boolean
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [filmQuery, setFilmQuery] = useState('')
  const [textDraft, setTextDraft] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const directors = useMemo(() => distinctDirectors(films), [films])
  const countries = useMemo(() => distinctCountries(films), [films])

  const filmResults = useMemo(() => {
    const q = filmQuery.trim().toLowerCase()
    if (!q) return []
    return films
      .filter((f) => f.title.toLowerCase().includes(q) || f.director.toLowerCase().includes(q))
      .slice(0, 8)
  }, [filmQuery, films])

  const remove = (id: string) => onChange(slices.filter((s) => s.id !== id))

  const toggleMute = (id: string) =>
    onChange(slices.map((s) => (s.id === id ? { ...s, muted: !s.muted } : s)))

  const liveCount = slices.filter((s) => !s.muted).length

  const addFilm = (film: Film) => {
    onChange([...slices, { id: uid(), type: 'film', filmId: film.id }])
    setFilmQuery('')
  }

  const addText = () => {
    const text = textDraft.trim()
    if (!text) return
    onChange([...slices, { id: uid(), type: 'text', text }])
    setTextDraft('')
  }

  const saveFilter = () => {
    if (mode.kind !== 'filter') return
    const label = mode.label.trim() || 'Untitled category'
    if (mode.editingId) {
      onChange(
        slices.map((s) =>
          s.id === mode.editingId && s.type === 'filter'
            ? { ...s, label, conditions: mode.conditions, scope: mode.scope }
            : s,
        ),
      )
    } else {
      onChange([
        ...slices,
        { id: uid(), type: 'filter', label, conditions: mode.conditions, scope: mode.scope },
      ])
    }
    setMode({ kind: 'closed' })
  }

  const editFilter = (slice: Slice & { type: 'filter' }) =>
    setMode({
      kind: 'filter',
      editingId: slice.id,
      label: slice.label,
      conditions: structuredClone(slice.conditions),
      scope: slice.scope ?? 'library',
    })

  return (
    <section className="card flex min-h-0 min-w-0 flex-col p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-bold text-[var(--ink)]">On the wheel</h2>
        <span className="text-xs font-semibold text-[var(--ink-faint)]">
          {liveCount < slices.length
            ? `${liveCount} of ${slices.length} slices live`
            : `${slices.length} slice${slices.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <ul className="m-0 flex list-none flex-col gap-1.5 overflow-y-auto p-0">
        {slices.map((s, i) => {
          const isFilter = s.type === 'filter'
          const isCatalogSlice = isFilter && s.scope === 'catalog'
          const matched =
            isFilter && !isCatalogSlice ? matchFilms(films, s.conditions) : null
          const expanded = expandedId === s.id && matched != null
          // dot colors track the live wheel, which skips muted slices
          const activeIdx = slices.slice(0, i).filter((x) => !x.muted).length
          const dotColor = s.muted ? 'rgba(110,98,78,0.5)' : sliceColor(activeIdx, liveCount)
          return (
            <li key={s.id} className={s.muted ? 'opacity-55' : undefined}>
              <div className="group relative flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-[var(--line)] hover:bg-black/20">
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{
                    background: isCatalogSlice
                      ? `repeating-linear-gradient(45deg, ${dotColor} 0 2.5px, rgba(242,193,120,0.55) 2.5px 4.5px)`
                      : dotColor,
                  }}
                />
                <span className="flex-shrink-0 text-[var(--ink-faint)]">
                  {s.type === 'film' && <FilmIcon size={14} />}
                  {s.type === 'text' && <Type size={14} />}
                  {isFilter && <SlidersHorizontal size={14} />}
                </span>
                <span
                  className={`flex min-w-0 flex-1 items-baseline gap-2 text-sm ${s.muted ? 'line-through decoration-[rgba(240,230,210,0.35)]' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate" title={sliceLabel(s, films)}>
                    {sliceLabel(s, films)}
                  </span>
                  {isCatalogSlice && (
                    <span className="flex-shrink-0 whitespace-nowrap text-xs text-[var(--gold)]">
                      whole catalog
                    </span>
                  )}
                  {matched != null && (
                    <button
                      className={`flex-shrink-0 whitespace-nowrap text-xs underline decoration-dotted underline-offset-2 ${matched.length === 0 ? 'text-[#c96a5a]' : 'text-[var(--ink-faint)] hover:text-[var(--gold-bright)]'}`}
                      onClick={() => setExpandedId(expanded ? null : s.id)}
                      title={expanded ? 'Hide matches' : 'Show the matching films'}
                    >
                      {matched.length.toLocaleString()} match{matched.length === 1 ? '' : 'es'}
                    </button>
                  )}
                </span>
                {/* actions float over the row so they don't steal width */}
                <span
                  className={`absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-[linear-gradient(90deg,transparent,#201913_26%)] py-0.5 pl-8 pr-0.5 transition-opacity focus-within:opacity-100 ${s.muted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  {isFilter && (
                    <button
                      className="btn-ghost btn !p-1.5"
                      onClick={() => editFilter(s)}
                      disabled={disabled}
                      aria-label={`Edit category ${s.label}`}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  <button
                    className="btn-ghost btn !p-1.5"
                    onClick={() => toggleMute(s.id)}
                    disabled={disabled}
                    title={s.muted ? 'Unmute — back on the wheel' : 'Mute — keep it, skip it on the wheel'}
                    aria-label={`${s.muted ? 'Unmute' : 'Mute'} ${sliceLabel(s, films)}`}
                  >
                    {s.muted ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    className="btn-ghost btn !p-1.5"
                    onClick={() => remove(s.id)}
                    disabled={disabled}
                    aria-label={`Remove ${sliceLabel(s, films)}`}
                  >
                    <X size={14} />
                  </button>
                </span>
              </div>
              {expanded && (
                <ul className="m-0 mt-1 max-h-56 list-none overflow-y-auto rounded-lg border border-[var(--line)] bg-black/25 p-2">
                  {matched.slice(0, 150).map((f) => (
                    <li key={f.id} className="truncate px-2 py-0.5 text-xs text-[var(--ink-dim)]">
                      {f.title} <span className="text-[var(--ink-faint)]">({f.year})</span>
                    </li>
                  ))}
                  {matched.length > 150 && (
                    <li className="px-2 py-1 text-xs text-[var(--ink-faint)]">
                      …and {(matched.length - 150).toLocaleString()} more
                    </li>
                  )}
                  {matched.length === 0 && (
                    <li className="px-2 py-1 text-xs text-[#c96a5a]">
                      Nothing matches — edit the category or sync more films in the Library.
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
        {slices.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--line)] px-3 py-6 text-center text-sm text-[var(--ink-dim)]">
            Empty wheel — add a category, a specific film, or some text below. Land on a
            category and a subwheel spins.
          </li>
        )}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
        <button
          className={`btn ${mode.kind === 'filter' ? 'btn-solid' : ''}`}
          onClick={() =>
            setMode(
              mode.kind === 'filter'
                ? { kind: 'closed' }
                : {
                  kind: 'filter',
                  editingId: null,
                  label: '',
                  conditions: [emptyCondition('service')],
                  scope: 'library',
                },
            )
          }
          disabled={disabled}
        >
          <SlidersHorizontal size={14} /> Category
        </button>
        <button
          className={`btn ${mode.kind === 'film' ? 'btn-solid' : ''}`}
          onClick={() => setMode(mode.kind === 'film' ? { kind: 'closed' } : { kind: 'film' })}
          disabled={disabled}
        >
          <FilmIcon size={14} /> Specific film
        </button>
        <button
          className={`btn ${mode.kind === 'text' ? 'btn-solid' : ''}`}
          onClick={() => setMode(mode.kind === 'text' ? { kind: 'closed' } : { kind: 'text' })}
          disabled={disabled}
        >
          <Type size={14} /> Text
        </button>
      </div>

      {mode.kind === 'film' && (
        <div className="mt-3">
          <input
            className="field"
            placeholder="Search your library…"
            value={filmQuery}
            onChange={(e) => setFilmQuery(e.target.value)}
            autoFocus
          />
          {filmResults.length > 0 && (
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
              {filmResults.map((film) => (
                <li key={film.id}>
                  <button
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[rgba(217,154,61,0.12)]"
                    onClick={() => addFilm(film)}
                  >
                    <span className="text-[var(--ink)]">{film.title}</span>
                    <span className="text-xs text-[var(--ink-dim)]">
                      {film.year} · {film.director}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {filmQuery.trim() && filmResults.length === 0 && (
            <p className="mb-0 mt-2 text-sm text-[var(--ink-dim)]">
              Nothing in the library — add it on the Library page.
            </p>
          )}
        </div>
      )}

      {mode.kind === 'text' && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addText()
          }}
        >
          <input
            className="field"
            placeholder='e.g. "Dealer’s choice" or "Rewatch an old favorite"'
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-solid flex-shrink-0">
            <Plus size={14} /> Add
          </button>
        </form>
      )}

      {mode.kind === 'filter' && (
        <FilterForm
          mode={mode}
          setMode={setMode}
          films={films}
          directors={directors}
          countries={countries}
          onSave={saveFilter}
        />
      )}
    </section>
  )
}

function FilterForm({
  mode,
  setMode,
  films,
  directors,
  countries,
  onSave,
}: {
  mode: Extract<Mode, { kind: 'filter' }>
  setMode: (m: Mode) => void
  films: Film[]
  directors: string[]
  countries: string[]
  onSave: () => void
}) {
  const [directorDraft, setDirectorDraft] = useState('')
  const isCatalog = mode.scope === 'catalog'
  const matches = matchFilms(films, mode.conditions)

  const setScope = (scope: 'library' | 'catalog') => {
    if (scope === 'catalog') {
      const kept = mode.conditions.filter((c) => CATALOG_KINDS.includes(c.kind))
      setMode({
        ...mode,
        scope,
        conditions: kept.length ? kept : [emptyCondition('service')],
      })
    } else {
      setMode({ ...mode, scope })
    }
  }

  const setCondition = (i: number, c: Condition) =>
    setMode({ ...mode, conditions: mode.conditions.map((x, j) => (j === i ? c : x)) })

  const removeCondition = (i: number) =>
    setMode({ ...mode, conditions: mode.conditions.filter((_, j) => j !== i) })

  const toggle = (values: string[], v: string) =>
    values.includes(v) ? values.filter((x) => x !== v) : [...values, v]

  return (
    <div className="mt-3 rounded-xl border border-[var(--line)] bg-black/20 p-3">
      <input
        className="field mb-3"
        placeholder='Category name — e.g. "Mubi night", "Anything 70s"'
        value={mode.label}
        onChange={(e) => setMode({ ...mode, label: e.target.value })}
        autoFocus
      />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button className={`chip ${!isCatalog ? 'is-on' : ''}`} onClick={() => setScope('library')}>
          Built-in library
        </button>
        <button className={`chip ${isCatalog ? 'is-on' : ''}`} onClick={() => setScope('catalog')}>
          Whole catalog
        </button>
        <span className="text-xs text-[var(--ink-faint)]">
          {isCatalog
            ? 'everything on the service via TMDB — service & year conditions only'
            : 'the shipped library plus anything you’ve added'}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {mode.conditions.map((c, i) => (
          <Fragment key={i}>
          {i > 0 && (
            <div className="flex items-center gap-2.5 px-1">
              <span className="h-px flex-1 bg-[var(--line)]" />
              <span className="rounded border border-[var(--line-strong)] bg-[rgba(217,154,61,0.1)] px-1.5 py-0.5 text-[0.62rem] font-bold tracking-[0.1em] text-[var(--gold)]">
                AND
              </span>
              <span className="h-px flex-1 bg-[var(--line)]" />
            </div>
          )}
          <div className="rounded-lg border border-[var(--line)] p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <select
                className="field !w-auto !py-1.5 text-sm"
                value={c.kind}
                onChange={(e) => setCondition(i, emptyCondition(e.target.value as ConditionKind))}
              >
                <option value="service">Streaming on</option>
                <option value="year">Year range</option>
                {!isCatalog && (
                  <>
                    <option value="list">Appears on list</option>
                    <option value="rank">TSPDT rank</option>
                    <option value="director">Directed by</option>
                    <option value="country">Country</option>
                  </>
                )}
              </select>
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink-faint)]">
                {conditionSummary(c)}
              </span>
              <button
                className="btn-ghost btn !p-1"
                onClick={() => removeCondition(i)}
                aria-label="Remove condition"
              >
                <X size={13} />
              </button>
            </div>

            {c.kind === 'service' && (
              <div className="flex flex-wrap gap-1.5">
                {SERVICES.map((s) => (
                  <button
                    key={s.id}
                    className={`chip ${c.services.includes(s.id) ? 'is-on' : ''}`}
                    onClick={() => setCondition(i, { ...c, services: toggle(c.services, s.id) })}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {c.kind === 'list' && (
              <div className="flex flex-wrap gap-1.5">
                {LISTS.map((l) => (
                  <button
                    key={l.id}
                    className={`chip ${c.lists.includes(l.id) ? 'is-on' : ''}`}
                    onClick={() => setCondition(i, { ...c, lists: toggle(c.lists, l.id) })}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}

            {c.kind === 'country' && (
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {countries.map((country) => (
                  <button
                    key={country}
                    className={`chip ${c.countries.includes(country) ? 'is-on' : ''}`}
                    onClick={() => setCondition(i, { ...c, countries: toggle(c.countries, country) })}
                  >
                    {country}
                  </button>
                ))}
              </div>
            )}

            {c.kind === 'rank' && (
              <div className="flex items-center gap-2 text-sm text-[var(--ink-dim)]">
                <span>Top</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  className="field !w-24 !py-1.5"
                  value={c.max ?? ''}
                  placeholder="1000"
                  onChange={(e) =>
                    setCondition(i, {
                      ...c,
                      max: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
                <span>on the TSPDT 1,000</span>
              </div>
            )}

            {c.kind === 'year' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="field !w-24 !py-1.5"
                  placeholder="From"
                  value={c.from ?? ''}
                  onChange={(e) =>
                    setCondition(i, {
                      ...c,
                      from: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
                <span className="text-[var(--ink-dim)]">—</span>
                <input
                  type="number"
                  className="field !w-24 !py-1.5"
                  placeholder="To"
                  value={c.to ?? ''}
                  onChange={(e) =>
                    setCondition(i, {
                      ...c,
                      to: e.target.value === '' ? undefined : Number(e.target.value),
                    })
                  }
                />
              </div>
            )}

            {c.kind === 'director' && (
              <div>
                <Typeahead
                  options={directors}
                  value={directorDraft}
                  onChange={setDirectorDraft}
                  onPick={(name) => {
                    setCondition(i, { ...c, directors: toggle(c.directors, name) })
                    setDirectorDraft('')
                  }}
                  placeholder="Type a director…"
                />
                {c.directors.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {c.directors.map((d, j) => (
                      <Fragment key={d}>
                        {j > 0 && (
                          <span className="text-[0.65rem] font-semibold text-[var(--ink-faint)]">
                            or
                          </span>
                        )}
                        <button
                          className="chip is-on"
                          onClick={() => setCondition(i, { ...c, directors: toggle(c.directors, d) })}
                        >
                          {d} <X size={11} />
                        </button>
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </Fragment>
        ))}
      </div>

      <button
        className="btn-ghost btn mt-2 text-xs"
        onClick={() =>
          setMode({
            ...mode,
            conditions: [...mode.conditions, emptyCondition(isCatalog ? 'year' : 'list')],
          })
        }
      >
        <Plus size={13} /> Add condition (AND)
      </button>

      {/* live preview of what this filter currently matches */}
      {!isCatalog && (
        <div className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-[var(--line)] bg-black/25 p-1.5">
          {matches.slice(0, 100).map((f) => (
            <div key={f.id} className="truncate px-2 py-0.5 text-xs text-[var(--ink-dim)]">
              {f.title} <span className="text-[var(--ink-faint)]">({f.year}) · {f.director}</span>
            </div>
          ))}
          {matches.length > 100 && (
            <div className="px-2 py-1 text-xs text-[var(--ink-faint)]">
              …and {(matches.length - 100).toLocaleString()} more
            </div>
          )}
          {matches.length === 0 && (
            <div className="px-2 py-1 text-xs text-[#c96a5a]">
              No films match — the wheel can’t land here.
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <span
          className={`text-sm ${!isCatalog && matches.length === 0 ? 'text-[#c96a5a]' : 'text-[var(--ink-dim)]'}`}
        >
          {isCatalog
            ? 'spins from the live TMDB catalog'
            : `${matches.length.toLocaleString()} film${matches.length === 1 ? '' : 's'} match`}
        </span>
        <div className="flex gap-2">
          <button className="btn-ghost btn" onClick={() => setMode({ kind: 'closed' })}>
            Cancel
          </button>
          <button className="btn btn-solid" onClick={onSave}>
            {mode.editingId ? 'Save category' : 'Add to wheel'}
          </button>
        </div>
      </div>
    </div>
  )
}
