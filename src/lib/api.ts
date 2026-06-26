import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { mapProviders, PROVIDER_IDS, tmdbFetch } from './tmdb-core'
import { logTrace, openaiUsage, type Usage } from './langfuse'
import type { Film } from './types'

function key(): string {
  const k = process.env.TMDB_API_KEY
  if (!k) throw new Error('TMDB_API_KEY is not set (add it to .dev.vars locally, or `wrangler secret put TMDB_API_KEY` for deploys)')
  return k
}

function openaiKey(): string {
  const k = process.env.OPENAI_API_KEY
  if (!k) throw new Error('OPENAI_API_KEY is not set (add it to .dev.vars locally, or `wrangler secret put OPENAI_API_KEY` for deploys)')
  return k
}

export type TmdbSearchResult = {
  tmdbId: number
  title: string
  year: number | null
  poster: string | null
  overview: string
}

/** Cloudflare puts the visitor's country in this header — use it as the default region. */
export const guessRegion = createServerFn({ method: 'GET' }).handler((): string => {
  const country = getRequest().headers.get('cf-ipcountry')
  return country && /^[A-Z]{2}$/.test(country) ? country : 'CA'
})

export const searchMovies = createServerFn({ method: 'GET' })
  .inputValidator((d: { query: string; year?: number }) => d)
  .handler(async ({ data }): Promise<TmdbSearchResult[]> => {
    if (!data.query.trim()) return []
    const params: Record<string, string> = { query: data.query.trim() }
    if (data.year) params.primary_release_year = String(data.year)
    const res = await tmdbFetch(key(), '/search/movie', params)
    return (res.results ?? []).slice(0, 6).map((m: any) => ({
      tmdbId: m.id,
      title: m.title,
      year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
      poster: m.poster_path ?? null,
      overview: m.overview ?? '',
    }))
  })

export const movieDetails = createServerFn({ method: 'GET' })
  .inputValidator((d: { tmdbId: number }) => d)
  .handler(async ({ data }) => {
    const m = await tmdbFetch(key(), `/movie/${data.tmdbId}`, { append_to_response: 'credits' })
    const directors = (m.credits?.crew ?? [])
      .filter((c: any) => c.job === 'Director')
      .map((c: any) => c.name)
    return {
      tmdbId: m.id as number,
      title: m.title as string,
      year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
      director: directors.join(' & ') || 'Unknown',
      country: (m.production_countries?.[0]?.name as string) ?? 'Unknown',
      poster: (m.poster_path as string | null) ?? null,
    }
  })

// NOTE: no bulk-sync endpoint on purpose — walking whole catalogs is an easy
// way for a visitor to burn the TMDB key. Availability ships in the snapshot
// (pnpm build-library) instead.

export type CatalogSample = {
  total: number
  films: Array<{ tmdbId: number; title: string; year: number | null; poster: string | null }>
}

/**
 * Sample random films from the *entire* catalog of one or more streaming
 * services via TMDB Discover (JustWatch data) — not limited to the library.
 */
export const catalogSample = createServerFn({ method: 'GET' })
  .inputValidator(
    (d: { services: string[]; region: string; yearFrom?: number; yearTo?: number; count: number }) => d,
  )
  .handler(async ({ data }): Promise<CatalogSample> => {
    const providers = data.services
      .map((s) => PROVIDER_IDS[s])
      .filter(Boolean)
      .join('|')
    if (!providers) return { total: 0, films: [] }

    const params: Record<string, string> = {
      watch_region: /^[A-Z]{2}$/.test(data.region) ? data.region : 'CA',
      with_watch_providers: providers,
      with_watch_monetization_types: 'flatrate',
      sort_by: 'popularity.desc',
    }
    if (data.yearFrom) params['primary_release_date.gte'] = `${data.yearFrom}-01-01`
    if (data.yearTo) params['primary_release_date.lte'] = `${data.yearTo}-12-31`

    const first = await tmdbFetch(key(), '/discover/movie', { ...params, page: '1' })
    const total: number = first.total_results ?? 0
    if (total === 0) return { total: 0, films: [] }
    const totalPages = Math.min(first.total_pages ?? 1, 500)

    // pages chosen uniformly at random so deep-catalog films get the same
    // odds as the popular stuff on page 1
    const pageNums = new Set<number>()
    while (pageNums.size < Math.min(3, totalPages)) {
      pageNums.add(1 + Math.floor(Math.random() * totalPages))
    }
    const pages = await Promise.all(
      [...pageNums].map((p) =>
        p === 1 ? first : tmdbFetch(key(), '/discover/movie', { ...params, page: String(p) }),
      ),
    )
    const pool = pages.flatMap((pg) => pg.results ?? [])
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    const seen = new Set<number>()
    const films = []
    for (const m of pool) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      films.push({
        tmdbId: m.id as number,
        title: m.title as string,
        year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
        poster: (m.poster_path as string | null) ?? null,
      })
      if (films.length >= data.count) break
    }
    return { total, films }
  })

// ── AI-described categories ──────────────────────────────────────────────
// An LLM turns a natural-language category ("so-bad-it's-good sci-fi",
// "movies about grief") into a list of real films. The model proposes titles
// from its own knowledge — not limited to our library — and every proposal is
// grounded through TMDB before it can reach the wheel: a title that doesn't
// resolve to a real movie is dropped, so nothing hallucinated slips on.

const OPENAI_MODEL = 'gpt-5.4'

const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string', description: 'A short, punchy wheel label for the category (≤ 32 chars).' },
    films: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'The exact title as it would appear on TMDB.' },
          year: { type: 'integer', description: 'Release / first-air year (best guess if unsure).' },
        },
        required: ['title', 'year'],
      },
    },
  },
  required: ['label', 'films'],
}

export type Medium = 'movie' | 'tv'

type Proposal = {
  label: string
  films: { title: string; year: number }[]
  usage?: Usage
  startTime: string
  endTime: string
}

/** Ask the model for candidate films/shows matching a free-text category. */
async function proposeFilms(prompt: string, count: number, medium: Medium): Promise<Proposal> {
  const noun = medium === 'tv' ? 'TV shows' : 'films'
  const yearHint = medium === 'tv' ? 'first-air-year' : 'release year'
  const system =
    `You curate themed ${noun} lists. Given a category, return real ${noun} that fit it, ` +
    'drawing on your full knowledge — do not limit yourself to famous titles. ' +
    `Prefer precise, real titles with correct ${yearHint}s so they can be looked up. ` +
    'Spread across eras and countries when the category allows. Return only the JSON.'
  const user = `Category: ${prompt}\n\nReturn about ${Math.ceil(count * 1.6)} ${noun} (we drop any that fail lookup).`

  const startTime = new Date().toISOString()
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${openaiKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'film_picks', strict: true, schema: PICK_SCHEMA } },
      max_completion_tokens: 6000,
      reasoning_effort: 'medium',
    }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: unknown }
  const endTime = new Date().toISOString()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('openai: empty content')
  const parsed = JSON.parse(content) as { label: string; films: { title: string; year: number }[] }
  return { ...parsed, usage: openaiUsage(data.usage), startTime, endTime }
}

/** Ground one proposed title against TMDB → a real film/show with poster, credits, services. */
async function groundFilm(
  tmdbKey: string,
  region: string,
  cand: { title: string; year: number },
  medium: Medium,
): Promise<Film | null> {
  return medium === 'tv'
    ? groundTv(tmdbKey, region, cand)
    : groundMovie(tmdbKey, region, cand)
}

async function groundMovie(
  tmdbKey: string,
  region: string,
  cand: { title: string; year: number },
): Promise<Film | null> {
  const exact = await tmdbFetch(tmdbKey, '/search/movie', {
    query: cand.title,
    primary_release_year: String(cand.year),
  })
  let hit = exact.results?.[0]
  if (!hit) {
    // festival vs wide-release years differ by a year sometimes
    const loose = await tmdbFetch(tmdbKey, '/search/movie', { query: cand.title })
    hit = (loose.results ?? []).find((m: any) => {
      const y = m.release_date ? Number(m.release_date.slice(0, 4)) : null
      return y != null && Math.abs(y - cand.year) <= 1
    })
  }
  if (!hit) return null

  const m = await tmdbFetch(tmdbKey, `/movie/${hit.id}`, { append_to_response: 'credits,watch/providers' })
  const directors = (m.credits?.crew ?? []).filter((c: any) => c.job === 'Director').map((c: any) => c.name)
  const regional = m['watch/providers']?.results?.[region]
  return {
    id: `ai-t${m.id}`,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : cand.year,
    director: directors.join(' & ') || 'Unknown',
    country: m.production_countries?.[0]?.name ?? 'Unknown',
    services: mapProviders(regional?.flatrate),
    lists: [],
    tmdbId: m.id,
    poster: m.poster_path ?? undefined,
  }
}

async function groundTv(
  tmdbKey: string,
  region: string,
  cand: { title: string; year: number },
): Promise<Film | null> {
  const exact = await tmdbFetch(tmdbKey, '/search/tv', {
    query: cand.title,
    first_air_date_year: String(cand.year),
  })
  let hit = exact.results?.[0]
  if (!hit) {
    const loose = await tmdbFetch(tmdbKey, '/search/tv', { query: cand.title })
    hit = (loose.results ?? []).find((t: any) => {
      const y = t.first_air_date ? Number(t.first_air_date.slice(0, 4)) : null
      return y != null && Math.abs(y - cand.year) <= 1
    })
  }
  if (!hit) return null

  const t = await tmdbFetch(tmdbKey, `/tv/${hit.id}`, { append_to_response: 'watch/providers' })
  const creators = (t.created_by ?? []).map((c: any) => c.name)
  const regional = t['watch/providers']?.results?.[region]
  return {
    id: `ai-tv${t.id}`,
    title: t.name,
    year: t.first_air_date ? Number(t.first_air_date.slice(0, 4)) : cand.year,
    director: creators.join(' & ') || 'Unknown',
    country: t.production_countries?.[0]?.name ?? t.origin_country?.[0] ?? 'Unknown',
    services: mapProviders(regional?.flatrate),
    lists: [],
    tmdbId: t.id,
    mediaType: 'tv',
    poster: t.poster_path ?? undefined,
  }
}

// A cheap, low-effort call that returns a couple of evocative sentences to
// show *while* the (slower) grounded pick is being assembled — pure flavor, so
// it fails soft to an empty string and never blocks the real work.
const BLURB_MODEL = 'gpt-5.4' // swap to a mini/nano model here if your account has one

export const aiCategoryBlurb = createServerFn({ method: 'POST' })
  .inputValidator((d: { prompt: string; medium?: Medium; sessionId?: string }) => d)
  .handler(async ({ data }): Promise<string> => {
    const prompt = data.prompt.trim()
    if (!prompt) return ''
    const medium: Medium = data.medium === 'tv' ? 'tv' : 'movie'
    const persona = medium === 'tv' ? 'TV critic' : 'film curator'
    try {
      const startTime = new Date().toISOString()
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${openaiKey()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: BLURB_MODEL,
          messages: [
            {
              role: 'system',
              content:
                `You're a witty, deeply-read ${persona}. The user names a category; reply with ONE short, vivid sentence riffing on it (max ~20 words). No lists, no preamble, no meta-talk about waiting — just the single remark.`,
            },
            { role: 'user', content: prompt },
          ],
          max_completion_tokens: 700,
          reasoning_effort: 'low',
        }),
      })
      if (!res.ok) return ''
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: unknown }
      const endTime = new Date().toISOString()
      const blurb = json.choices?.[0]?.message?.content?.trim() ?? ''
      await logTrace({
        name: 'ai-category-blurb',
        sessionId: data.sessionId,
        tags: ['describe-category', medium],
        input: prompt,
        output: blurb,
        startTime,
        endTime,
        generations: [
          {
            name: 'category-blurb',
            model: BLURB_MODEL,
            input: { category: prompt },
            output: blurb,
            usage: openaiUsage(json.usage),
            startTime,
            endTime,
            metadata: { reasoning_effort: 'low' },
          },
        ],
      })
      return blurb
    } catch {
      return ''
    }
  })

export type AiPick = { label: string; films: Film[] }

/**
 * Turn a natural-language category into a grounded list of real films:
 * the model proposes titles, TMDB resolves each one (dropping misses), and we
 * return films carrying real posters + streaming availability for the region.
 */
export const aiPickFilms = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: { prompt: string; region: string; count?: number; medium?: Medium; sessionId?: string }) => d,
  )
  .handler(async ({ data }): Promise<AiPick> => {
    const prompt = data.prompt.trim()
    if (!prompt) return { label: '', films: [] }
    const region = /^[A-Z]{2}$/.test(data.region) ? data.region : 'CA'
    const count = Math.min(Math.max(data.count ?? 12, 1), 24)
    const medium: Medium = data.medium === 'tv' ? 'tv' : 'movie'

    const proposal = await proposeFilms(prompt, count, medium)
    const candidates = proposal.films

    const groundStart = new Date().toISOString()
    const tmdbKey = key()
    const resolved = await Promise.all(
      candidates.map((c) => groundFilm(tmdbKey, region, c, medium).catch(() => null)),
    )

    // dedupe by tmdbId, keep order, cap at count
    const seen = new Set<number>()
    const films: Film[] = []
    for (const f of resolved) {
      if (!f || !f.tmdbId || seen.has(f.tmdbId)) continue
      seen.add(f.tmdbId)
      films.push(f)
      if (films.length >= count) break
    }
    const groundEnd = new Date().toISOString()
    const result: AiPick = { label: proposal.label || prompt, films }

    // Trace: the LLM proposal (generation) + TMDB grounding (span) under one trace.
    await logTrace({
      name: medium === 'tv' ? 'ai-pick-tv' : 'ai-pick-films',
      sessionId: data.sessionId,
      tags: ['describe-category', medium],
      input: prompt,
      output: { label: result.label, films: films.map((f) => `${f.title} (${f.year})`) },
      metadata: {
        medium,
        region,
        requested: count,
        proposed: candidates.length,
        grounded: films.length,
      },
      startTime: proposal.startTime,
      endTime: groundEnd,
      generations: [
        {
          name: 'propose-films',
          model: OPENAI_MODEL,
          input: { category: prompt },
          output: { label: proposal.label, films: candidates },
          usage: proposal.usage,
          startTime: proposal.startTime,
          endTime: proposal.endTime,
          metadata: { reasoning_effort: 'medium' },
        },
      ],
      spans: [
        {
          name: 'tmdb-grounding',
          input: { candidates: candidates.length },
          output: { grounded: films.length, dropped: candidates.length - films.length },
          startTime: groundStart,
          endTime: groundEnd,
        },
      ],
    })

    return result
  })
