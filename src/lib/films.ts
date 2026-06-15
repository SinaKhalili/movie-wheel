import snapshot from '../data/library.json'
import type { Film } from './types'

/**
 * The library shipped with the app: curated seeds, every canon list, and the
 * complete filmography of every director on those lists — with streaming
 * availability baked in at build time. Stored as compact rows
 * [title, year, director, country, services, lists, tmdbId, poster, tspdtRank];
 * regenerate with `pnpm build-library` (see scripts/build-library.ts).
 */
type Row = [string, number, string, string, string, string, number, string, number]

const raw = snapshot as unknown as { generatedAt: string; region: string; rows: Row[] }

export const SHIPPED = { generatedAt: raw.generatedAt, region: raw.region }

export const SHIPPED_FILMS: Film[] = raw.rows.map(
  ([title, year, director, country, services, lists, tmdbId, poster, tspdtRank]) => ({
    id: tmdbId
      ? `t${tmdbId}`
      : title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') + `-${year}`,
    title,
    year,
    director,
    country,
    services: services ? services.split('|') : [],
    lists: lists ? lists.split('|') : [],
    tmdbId: tmdbId || undefined,
    poster: poster || undefined,
    tspdtRank: tspdtRank || undefined,
  }),
)

export type Registry = { id: string; name: string }

export const SERVICES: Registry[] = [
  { id: 'mubi', name: 'Mubi' },
  { id: 'criterion-channel', name: 'Criterion Channel' },
  { id: 'netflix', name: 'Netflix' },
  { id: 'kanopy', name: 'Kanopy' },
]

export const LISTS: Registry[] = [
  { id: 'tspdt', name: 'TSPDT Top 1000' },
  { id: 'ss2022', name: 'Sight & Sound 2022' },
  { id: 'criterion', name: 'Criterion Collection' },
  { id: 'afi', name: 'AFI 100' },
  { id: 'worst200', name: 'Bottom 200' },
  { id: 'cannes', name: 'Palme d’Or' },
  { id: 'berlin', name: 'Golden Bear' },
  { id: 'venice', name: 'Golden Lion' },
  { id: 'tiff', name: 'TIFF People’s Choice' },
  { id: 'sundance', name: 'Sundance Grand Jury' },
]

export function serviceName(id: string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id
}

export function listName(id: string): string {
  return LISTS.find((l) => l.id === id)?.name ?? id
}

export function distinctDirectors(films: Film[]): string[] {
  return [...new Set(films.map((x) => x.director))].sort()
}

export function distinctCountries(films: Film[]): string[] {
  return [...new Set(films.map((x) => x.country))].sort()
}
