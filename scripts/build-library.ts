/**
 * Build the shipped library snapshot:
 *   1. curated seed films + every canon list (TSPDT, S&S 2022, Criterion, AFI)
 *   2. the COMPLETE filmography of every director that appears in step 1
 *   3. current streaming availability + country + poster for everything
 *
 * Usage:  pnpm build-library            (region defaults to CA)
 *         REGION=US pnpm build-library
 *
 * Reads TMDB_API_KEY from the environment or .dev.vars.
 * Writes src/data/library.json — commit the result. Expect ~20k TMDB calls
 * and a several-minute runtime.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED_FILMS } from '../src/data/seed-films'
import { mergeAllLists } from '../src/lib/lists'
import { mapProviders, resolveAvailability, tmdbFetch } from '../src/lib/tmdb-core'
import type { Film } from '../src/lib/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGION = process.env.REGION || 'CA'
const CONCURRENCY = 20

function apiKey(): string {
  if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY
  const devVars = join(ROOT, '.dev.vars')
  if (existsSync(devVars)) {
    const m = readFileSync(devVars, 'utf8').match(/^TMDB_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  }
  throw new Error('Set TMDB_API_KEY in the environment or .dev.vars')
}

async function inPool<T>(items: T[], fn: (item: T) => Promise<void>, label: string) {
  const queue = [...items]
  let done = 0
  const worker = async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
      done++
      if (done % 500 === 0) console.log(`  ${label}: ${done}/${items.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function slug(title: string, year: number): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + `-${year}`
  )
}

/** "Joel & Ethan Coen" -> ["Joel Coen", "Ethan Coen"]; multi-name strings split apart. */
function splitDirectorNames(raw: string): string[] {
  const parts = raw
    .split(/\s*(?:,|&|\/|\band\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length > 1) {
    const lastWords = parts[parts.length - 1].split(' ')
    if (lastWords.length > 1) {
      const surname = lastWords[lastWords.length - 1]
      return parts.map((p) => (p.includes(' ') ? p : `${p} ${surname}`))
    }
  }
  return parts
}

async function main() {
  const key = apiKey()

  // 1 — canon lists
  const { films, summary } = mergeAllLists(SEED_FILMS)
  console.log(
    `merged ${SEED_FILMS.length} seeds + lists = ${films.length} films`,
    JSON.stringify(summary),
  )

  // 2 — availability for the list films (also resolves their tmdbIds)
  let missed = 0
  await inPool(
    films,
    async (film) => {
      try {
        const r = await resolveAvailability(key, {
          tmdbId: film.tmdbId,
          title: film.title,
          year: film.year,
          region: REGION,
        })
        if (r) {
          film.tmdbId = r.tmdbId
          film.services = r.services
          if (r.poster) film.poster = r.poster
        } else missed++
      } catch {
        missed++
      }
    },
    'list availability',
  )
  console.log(`list films resolved (${missed} unmatched on TMDB)`)

  // 3 — complete filmographies for every director in the library
  const names = [...new Set(films.flatMap((f) => splitDirectorNames(f.director)))]
    .filter((n) => n && n !== 'Unknown' && n.includes(' '))
    .sort()
  console.log(`expanding filmographies for ${names.length} directors…`)

  type Credit = { tmdbId: number; title: string; year: number; person: string }
  const credits: Credit[] = []
  const unmatchedDirectors: string[] = []

  await inPool(
    names,
    async (name) => {
      try {
        const res = await tmdbFetch(key, '/search/person', { query: name })
        const results: any[] = res.results ?? []
        const exact = results.filter((p) => normName(p.name) === normName(name))
        const person =
          exact.find((p) => p.known_for_department === 'Directing') ??
          exact[0] ??
          (results[0]?.known_for_department === 'Directing' ? results[0] : null)
        if (!person) {
          unmatchedDirectors.push(name)
          return
        }
        const cr = await tmdbFetch(key, `/person/${person.id}/movie_credits`)
        for (const c of cr.crew ?? []) {
          if (c.job !== 'Director' || !c.release_date || c.adult) continue
          credits.push({
            tmdbId: c.id,
            title: c.title,
            year: Number(c.release_date.slice(0, 4)),
            person: person.name,
          })
        }
      } catch {
        unmatchedDirectors.push(name)
      }
    },
    'filmographies',
  )

  // merge credits into the library (dedupe by tmdbId)
  const byTmdb = new Map(films.filter((f) => f.tmdbId).map((f) => [f.tmdbId!, f]))
  const newFilms: Film[] = []
  for (const c of credits) {
    if (byTmdb.has(c.tmdbId)) continue
    const film: Film = {
      id: `${slug(c.title, c.year)}-t${c.tmdbId}`,
      title: c.title,
      year: c.year,
      director: c.person,
      country: 'Unknown',
      services: [],
      lists: [],
      tmdbId: c.tmdbId,
    }
    byTmdb.set(c.tmdbId, film)
    newFilms.push(film)
  }
  console.log(
    `${credits.length} directing credits -> ${newFilms.length} new films` +
      (unmatchedDirectors.length ? ` (no TMDB match: ${unmatchedDirectors.join(', ')})` : ''),
  )

  // 4 — one call per new film: details + providers together
  await inPool(
    newFilms,
    async (film) => {
      try {
        const m = await tmdbFetch(key, `/movie/${film.tmdbId}`, {
          append_to_response: 'watch/providers',
        })
        film.country = m.production_countries?.[0]?.name ?? 'Unknown'
        if (m.poster_path) film.poster = m.poster_path
        const regional = m['watch/providers']?.results?.[REGION]
        film.services = mapProviders(regional?.flatrate)
      } catch {
        // keep the bare credit data
      }
    },
    'new film details',
  )

  // 5 — country backfill for list films that still lack one
  const noCountry = films.filter((f) => f.country === 'Unknown' && f.tmdbId)
  await inPool(
    noCountry,
    async (film) => {
      try {
        const m = await tmdbFetch(key, `/movie/${film.tmdbId}`)
        film.country = m.production_countries?.[0]?.name ?? 'Unknown'
      } catch {
        // leave as Unknown
      }
    },
    'country backfill',
  )

  // dedupe by tmdbId, merging tags so no list membership is lost
  const all = [...films, ...newFilms]
  const byKey = new Map<number | string, Film>()
  for (const f of all) {
    const k = f.tmdbId || `${f.title.toLowerCase()}-${f.year}`
    const cur = byKey.get(k)
    if (cur) {
      cur.lists = [...new Set([...cur.lists, ...f.lists])]
      cur.tspdtRank ??= f.tspdtRank
      if (cur.services.length === 0) cur.services = f.services
      cur.poster ??= f.poster
      if (cur.country === 'Unknown' && f.country !== 'Unknown') cur.country = f.country
    } else {
      byKey.set(k, f)
    }
  }
  // compact row format — field names once, not 25k times (see films.ts loader)
  const rows = [...byKey.values()].map((f) => [
      f.title,
      f.year,
      f.director,
      f.country,
      f.services.join('|'),
      f.lists.join('|'),
      f.tmdbId ?? 0,
      f.poster ?? '',
      f.tspdtRank ?? 0,
    ])
  const out = {
    generatedAt: new Date().toISOString(),
    region: REGION,
    rows,
  }
  const path = join(ROOT, 'src', 'data', 'library.json')
  const json = JSON.stringify(out)
  writeFileSync(path, json)
  const withServices = all.filter((x) => x.services.length > 0).length
  console.log(
    `wrote ${rows.length} films (${(json.length / 1024 / 1024).toFixed(2)} MB) -> ${path}\n` +
      `  region ${REGION} · ${withServices} streaming somewhere · ${missed} list films unmatched`,
  )
}

void main()
