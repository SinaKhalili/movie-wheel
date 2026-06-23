import { Fragment, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Film as FilmIcon, Loader2, Maximize2, Pencil, Plus, SlidersHorizontal, Sparkles, Type, X } from 'lucide-react'
import type { Condition, ConditionKind, Film, Slice } from '../lib/types'
import { uid } from '../lib/types'
import { aiCategoryBlurb, aiPickFilms, type AiPick } from '../lib/api'
import { LISTS, SERVICES, distinctCountries, distinctDirectors, serviceName } from '../lib/films'
import { conditionSummary, matchFilms } from '../lib/filter'
import Typeahead from './Typeahead'
import { sliceColor } from './Wheel'

type Mode =
  | { kind: 'closed' }
  | { kind: 'film' }
  | { kind: 'text' }
  | { kind: 'ai' }
  | {
      kind: 'filter'
      editingId: string | null
      label: string
      conditions: Condition[]
      scope: 'library' | 'catalog'
    }

const CATALOG_KINDS: ConditionKind[] = ['service', 'year']

const AI_EXAMPLES = [
  'Iranian film festival classics',
  'Lynchian films not directed by Lynch',
  'so-bad-it’s-good 80s sci-fi',
  'movies about grief',
  'neon-soaked neo-noir',
  'cozy rainy-day rewatches',
  'surreal dreamlike cinema',
]

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
  region,
  onChange,
  onAddFilms,
  disabled,
}: {
  slices: Slice[]
  films: Film[]
  region: string
  onChange: (next: Slice[]) => void
  onAddFilms: (films: Film[]) => void
  disabled: boolean
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [filmQuery, setFilmQuery] = useState('')
  const [textDraft, setTextDraft] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [aiDraft, setAiDraft] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<AiPick | null>(null)
  const [aiBlurb, setAiBlurb] = useState<string | null>(null)
  const [detail, setDetail] = useState<Film | null>(null)

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

  // Describe a category in words → the model proposes films, TMDB grounds them.
  // The grounded survivors are shown as a preview gallery first; nothing reaches
  // the wheel until "Add to wheel" commits them as a tagged filter slice.
  const runAi = async (override?: string) => {
    const prompt = (override ?? aiDraft).trim()
    if (!prompt || aiBusy) return
    if (override) setAiDraft(override)
    setAiBusy(true)
    setAiError(null)
    setAiResult(null)
    setAiBlurb(null)
    // cheap flavor text runs alongside the real (slower) pick — fills the wait
    void aiCategoryBlurb({ data: { prompt } })
      .then((b) => b && setAiBlurb(b))
      .catch(() => {})
    try {
      const result = await aiPickFilms({ data: { prompt, region, count: 12 } })
      if (result.films.length === 0) {
        setAiError('Couldn’t ground any films for that — try rephrasing.')
        return
      }
      setAiResult(result)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setAiBusy(false)
    }
  }

  const closeAi = () => {
    setAiDraft('')
    setAiResult(null)
    setAiError(null)
    setAiBlurb(null)
    setMode({ kind: 'closed' })
  }

  const commitAi = () => {
    if (!aiResult || aiResult.films.length === 0) return
    const tag = `ai:${uid()}`
    onAddFilms(aiResult.films.map((f) => ({ ...f, lists: [...f.lists, tag] })))
    onChange([
      ...slices,
      {
        id: uid(),
        type: 'filter',
        label: aiResult.label.trim() || aiDraft.trim(),
        conditions: [{ kind: 'list', lists: [tag] }],
      },
    ])
    closeAi()
  }

  const dropCandidate = (tmdbId?: number) =>
    setAiResult((r) => (r ? { ...r, films: r.films.filter((f) => f.tmdbId !== tmdbId) } : r))

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
                {matched != null ? (
                  <button
                    type="button"
                    className={`flex min-w-0 flex-1 items-baseline gap-2 text-left text-sm ${s.muted ? 'line-through decoration-[rgba(240,230,210,0.35)]' : ''}`}
                    onClick={() => setExpandedId(expanded ? null : s.id)}
                    title={expanded ? 'Hide films' : 'Show the films in this category'}
                  >
                    {expanded ? (
                      <ChevronDown size={13} className="flex-shrink-0 self-center text-[var(--gold-bright)]" />
                    ) : (
                      <ChevronRight size={13} className="flex-shrink-0 self-center text-[var(--ink-faint)]" />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={sliceLabel(s, films)}>
                      {sliceLabel(s, films)}
                    </span>
                    <span
                      className={`flex-shrink-0 whitespace-nowrap text-xs ${matched.length === 0 ? 'text-[#c96a5a]' : expanded ? 'text-[var(--gold-bright)]' : 'text-[var(--ink-faint)]'}`}
                    >
                      {matched.length.toLocaleString()} film{matched.length === 1 ? '' : 's'}
                    </span>
                  </button>
                ) : s.type === 'film' ? (
                  <button
                    type="button"
                    className={`flex min-w-0 flex-1 items-baseline gap-2 text-left text-sm ${s.muted ? 'line-through decoration-[rgba(240,230,210,0.35)]' : ''}`}
                    onClick={() => {
                      const f = films.find((x) => x.id === s.filmId)
                      if (f) setDetail(f)
                    }}
                    title="View film details"
                  >
                    <span className="min-w-0 flex-1 truncate">{sliceLabel(s, films)}</span>
                  </button>
                ) : (
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
                  </span>
                )}
                {/* actions float over the row on desktop, sit inline on touch */}
                <span className={`row-actions ${s.muted ? 'is-pinned' : ''}`}>
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
                    <li key={f.id}>
                      <button
                        type="button"
                        className="flex w-full items-baseline gap-2 truncate rounded px-2 py-0.5 text-left text-xs text-[var(--ink-dim)] transition-colors hover:bg-[rgba(217,154,61,0.12)] hover:text-[var(--ink)]"
                        onClick={() => setDetail(f)}
                        title={`${f.title} (${f.year}) — view details`}
                      >
                        <span className="min-w-0 flex-1 truncate">{f.title}</span>
                        <span className="flex-shrink-0 text-[var(--ink-faint)]">{f.year}</span>
                      </button>
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

      <div className="mt-4 border-t border-[var(--line)] pt-4">
        {/* AI is the headline way to fill the wheel — big, glowing, first */}
        <button
          className={`btn btn-solid w-full !py-2.5 text-[0.95rem] ${mode.kind === 'ai' ? '' : 'ai-cta'}`}
          onClick={() => (mode.kind === 'ai' ? closeAi() : setMode({ kind: 'ai' }))}
          disabled={disabled}
        >
          <Sparkles size={16} /> Describe a category
        </button>

        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="mr-0.5 flex-shrink-0 text-[11px] text-[var(--ink-faint)]">or</span>
          <button
            className={`btn btn-ghost !gap-1 !px-2 !py-1 text-[11px] ${mode.kind === 'filter' ? 'btn-solid' : ''}`}
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
            <SlidersHorizontal size={12} /> Category
          </button>
          <button
            className={`btn btn-ghost !gap-1 !px-2 !py-1 text-[11px] ${mode.kind === 'film' ? 'btn-solid' : ''}`}
            onClick={() => setMode(mode.kind === 'film' ? { kind: 'closed' } : { kind: 'film' })}
            disabled={disabled}
          >
            <FilmIcon size={12} /> Film
          </button>
          <button
            className={`btn btn-ghost !gap-1 !px-2 !py-1 text-[11px] ${mode.kind === 'text' ? 'btn-solid' : ''}`}
            onClick={() => setMode(mode.kind === 'text' ? { kind: 'closed' } : { kind: 'text' })}
            disabled={disabled}
          >
            <Type size={12} /> Text
          </button>
        </div>
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

      {mode.kind === 'ai' && (
        <div className="mt-3">
          {!aiBusy && !aiResult && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void runAi()
                }}
              >
                <textarea
                  className="ai-field"
                  rows={3}
                  placeholder={
                    'Describe a category in your own words…\ne.g. “so-bad-it’s-good 80s sci-fi” or “quiet films about loneliness in big cities”'
                  }
                  value={aiDraft}
                  onChange={(e) => setAiDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      void runAi()
                    }
                  }}
                  autoFocus
                />
                {aiError && (
                  <p className="mb-0 mt-2 truncate text-xs text-[#c96a5a]">{aiError}</p>
                )}
                <button
                  type="submit"
                  className="btn btn-solid mt-2 w-full"
                  disabled={!aiDraft.trim()}
                >
                  <Sparkles size={14} /> Pick films
                </button>
              </form>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {AI_EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="chip" onClick={() => void runAi(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </>
          )}

          {aiBusy && (
            <div className="mt-3">
              <p className="ai-thinking m-0 text-sm font-medium leading-snug">
                {aiBlurb || 'Conjuring a category…'}
              </p>
              <ul className="m-0 mt-3 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <li key={i} className="ai-skeleton aspect-[2/3]" />
                ))}
              </ul>
            </div>
          )}

          {!aiBusy && aiResult && (
            <div className="mt-3">
              {aiBlurb && (
                <p className="mb-2 mt-0 text-xs italic leading-snug text-[var(--ink-dim)]">{aiBlurb}</p>
              )}
              <div className="mb-2 flex items-center gap-2">
                <input
                  className="field !py-1.5 text-sm"
                  value={aiResult.label}
                  onChange={(e) => setAiResult((r) => (r ? { ...r, label: e.target.value } : r))}
                  aria-label="Category name"
                />
                <span className="flex-shrink-0 text-xs text-[var(--ink-faint)]">
                  {aiResult.films.length} film{aiResult.films.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="m-0 grid max-h-72 list-none grid-cols-4 gap-2 overflow-y-auto p-0 sm:grid-cols-5">
                {aiResult.films.map((f) => (
                  <li key={f.tmdbId ?? f.id} className="group relative min-w-0">
                    <button
                      type="button"
                      className="relative block aspect-[2/3] w-full overflow-hidden rounded-md border border-[var(--line)] bg-[var(--bg-raised)] transition-transform hover:scale-[1.03] hover:border-[var(--gold)]"
                      onClick={() => setDetail(f)}
                      title={`${f.title} (${f.year}) — view details`}
                    >
                      {f.poster ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w185${f.poster}`}
                          alt={`${f.title} poster`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-[var(--ink-faint)]">
                          {f.title}
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/80 to-transparent pb-1 pt-3 text-[9px] font-semibold uppercase tracking-wide text-[var(--gold-bright)] opacity-0 transition-opacity group-hover:opacity-100">
                        <Maximize2 size={10} /> Details
                      </span>
                    </button>
                    <button
                      type="button"
                      className="absolute right-1 top-1 z-10 rounded-full bg-black/70 p-0.5 text-[var(--ink)] opacity-0 transition-opacity hover:bg-black/90 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        dropCandidate(f.tmdbId)
                      }}
                      aria-label={`Remove ${f.title}`}
                    >
                      <X size={12} />
                    </button>
                    <p className="m-0 mt-1 truncate text-[11px] leading-tight text-[var(--ink-dim)]" title={`${f.title} (${f.year})`}>
                      {f.title}
                    </p>
                    <span className="text-[10px] text-[var(--ink-faint)]">{f.year}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="ai-cta btn btn-solid mt-3 w-full !py-2.5 text-[0.95rem]"
                onClick={commitAi}
                disabled={aiResult.films.length === 0}
              >
                <Check size={16} /> Add {aiResult.films.length} to the wheel
              </button>
              <div className="mt-2 flex items-center justify-center gap-3 text-xs text-[var(--ink-faint)]">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-[var(--gold-bright)]"
                  onClick={() => void runAi()}
                >
                  <Loader2 size={12} /> Regenerate
                </button>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="hover:text-[var(--gold-bright)]"
                  onClick={() => setAiResult(null)}
                >
                  Edit prompt
                </button>
              </div>
            </div>
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

      {detail && <FilmDetail film={detail} onClose={() => setDetail(null)} />}
    </section>
  )
}

function FilmDetail({ film, onClose }: { film: Film; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="card relative flex w-full max-w-md gap-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="aspect-[2/3] w-32 flex-shrink-0 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--bg-raised)]">
          {film.poster ? (
            <img
              src={`https://image.tmdb.org/t/p/w342${film.poster}`}
              alt={`${film.title} poster`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-[var(--ink-faint)]">
              No poster
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 pr-6 text-lg font-bold leading-tight text-[var(--ink)]">
            {film.title} <span className="font-normal text-[var(--ink-dim)]">({film.year})</span>
          </h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-[var(--ink-faint)]">Director</dt>
            <dd className="m-0 text-[var(--ink-dim)]">{film.director}</dd>
            <dt className="text-[var(--ink-faint)]">Country</dt>
            <dd className="m-0 text-[var(--ink-dim)]">{film.country}</dd>
          </dl>
          <div className="mt-3">
            {film.services.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {film.services.map((s) => (
                  <span key={s} className="chip is-on !cursor-default">
                    {serviceName(s)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="m-0 text-xs text-[var(--ink-faint)]">Not streaming in your region.</p>
            )}
          </div>
          {film.tmdbId && (
            <a
              className="mt-3 inline-block text-xs text-[var(--gold)] underline decoration-dotted underline-offset-2 hover:text-[var(--gold-bright)]"
              href={`https://www.themoviedb.org/movie/${film.tmdbId}`}
              target="_blank"
              rel="noreferrer"
            >
              View on TMDB ↗
            </a>
          )}
        </div>
        <button
          type="button"
          className="btn-ghost btn absolute right-2 top-2 !p-1.5"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={16} />
        </button>
      </div>
    </div>
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
