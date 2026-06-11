import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { PROVIDER_IDS, tmdbFetch } from './tmdb-core'

function key(): string {
  const k = process.env.TMDB_API_KEY
  if (!k) throw new Error('TMDB_API_KEY is not set (add it to .dev.vars locally, or `wrangler secret put TMDB_API_KEY` for deploys)')
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
