/** Pure TMDB helpers shared by the server functions and the snapshot build script. */

const TMDB = 'https://api.themoviedb.org/3'

export async function tmdbFetch(
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
): Promise<any> {
  const url = new URL(`${TMDB}${path}`)
  url.searchParams.set('api_key', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('retry-after')) || 1 + attempt
      await new Promise((r) => setTimeout(r, wait * 1000))
      continue
    }
    if (!res.ok) throw new Error(`TMDB ${path} failed: ${res.status}`)
    return res.json()
  }
}

/** Map TMDB/JustWatch provider names onto our service tags. */
export function mapProviders(flatrate: Array<{ provider_name: string }> | undefined): string[] {
  const services = new Set<string>()
  for (const p of flatrate ?? []) {
    const n = p.provider_name.toLowerCase()
    if (n.includes('mubi')) services.add('mubi')
    else if (n.includes('criterion')) services.add('criterion-channel')
    else if (n.includes('netflix')) services.add('netflix')
    else if (n.includes('kanopy')) services.add('kanopy')
  }
  return [...services]
}

/** TMDB/JustWatch provider ids for our services (verified against /watch/providers/movie). */
export const PROVIDER_IDS: Record<string, number> = {
  mubi: 11,
  'criterion-channel': 258,
  netflix: 8,
  kanopy: 191,
}

export type Availability = {
  tmdbId: number
  services: string[]
  poster: string | null
} | null

/**
 * Resolve a film (by tmdbId, or by title+year search) and return its current
 * streaming services for a region. Returns null if the film can't be matched.
 */
export async function resolveAvailability(
  apiKey: string,
  data: { tmdbId?: number; title: string; year: number; region: string },
): Promise<Availability> {
  const region = /^[A-Z]{2}$/.test(data.region) ? data.region : 'CA'
  let tmdbId = data.tmdbId
  let poster: string | null = null

  if (!tmdbId) {
    const search = await tmdbFetch(apiKey, '/search/movie', {
      query: data.title,
      primary_release_year: String(data.year),
    })
    let hit = search.results?.[0]
    if (!hit) {
      // release years sometimes differ by one (festival vs wide release)
      const loose = await tmdbFetch(apiKey, '/search/movie', { query: data.title })
      hit = (loose.results ?? []).find((m: any) => {
        const y = m.release_date ? Number(m.release_date.slice(0, 4)) : null
        return y != null && Math.abs(y - data.year) <= 1
      })
    }
    if (!hit) return null
    tmdbId = hit.id
    poster = hit.poster_path ?? null
  }

  const prov = await tmdbFetch(apiKey, `/movie/${tmdbId}/watch/providers`)
  const regional = prov.results?.[region]
  return {
    tmdbId: tmdbId!,
    services: mapProviders(regional?.flatrate),
    poster,
  }
}
