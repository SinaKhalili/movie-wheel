import tspdtRaw from '../data/tspdt1000.json'
import ssRaw from '../data/ss2022.json'
import afiRaw from '../data/afi100.json'
import criterionRaw from '../data/criterion.json'
import festivalsRaw from '../data/festivals.json'
import worstRaw from '../data/worst200.json'
import type { Film } from './types'

/**
 * Canon list data shipped with the app:
 * - tspdt1000.json   — official TSPDT spreadsheet via scripts/import_tspdt.py
 * - ss2022.json      — full critics' 250 extracted from bfi.org.uk (2022 poll)
 * - afi100.json      — AFI 100 Years…100 Movies (2007) via Wikipedia
 * - criterion.json   — Criterion Collection spine list (criterion.com via
 *                      github.com/arrismo/criterioncollection, ~2022)
 */

type ListEntry = { title: string; year: number; director?: string; country?: string; rank?: number }

const TSPDT = tspdtRaw as Required<Pick<ListEntry, 'rank' | 'title' | 'year' | 'director' | 'country'>>[]
const SS2022 = ssRaw as ListEntry[]
const AFI = afiRaw as ListEntry[]
const CRITERION = criterionRaw as ListEntry[]
const WORST200 = worstRaw as ListEntry[]
const FESTIVALS = festivalsRaw as Record<string, ListEntry[]>

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|le|la|les|il|el|das|der|die) /, '')
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

function sameFilm(aTitle: string, aYear: number, bTitle: string, bYear: number): boolean {
  if (Math.abs(aYear - bYear) > 1) return false
  const a = norm(aTitle)
  const b = norm(bTitle)
  if (a === b) return true
  // catches truncated titles like "Jeanne Dielman, 23 quai du Commerce"
  return a.length >= 6 && b.length >= 6 && (a.startsWith(b) || b.startsWith(a))
}

function mergeList(
  films: Film[],
  entries: ListEntry[],
  tag: string,
  opts: { setTspdtRank?: boolean } = {},
): { added: number; matched: number } {
  let added = 0
  let matched = 0
  for (const entry of entries) {
    const existing = films.find((f) => sameFilm(entry.title, entry.year, f.title, f.year))
    if (existing) {
      if (!existing.lists.includes(tag)) existing.lists.push(tag)
      if (opts.setTspdtRank) existing.tspdtRank = entry.rank
      matched++
    } else {
      films.push({
        id: slug(entry.title, entry.year),
        title: entry.title,
        year: entry.year,
        director: entry.director || 'Unknown',
        country: entry.country || 'Unknown',
        services: [],
        lists: [tag],
        tspdtRank: opts.setTspdtRank ? entry.rank : undefined,
      })
      added++
    }
  }
  return { added, matched }
}

export type MergeSummary = Record<string, { added: number; matched: number }>

/**
 * Sync the library against every shipped canon list: existing films get
 * accurate tags (and TSPDT ranks), missing entries are added. Stale list
 * tags are cleared first so re-syncing stays accurate.
 */
const FESTIVAL_TAGS = ['cannes', 'berlin', 'venice', 'tiff', 'sundance']

export function mergeAllLists(films: Film[]): { films: Film[]; summary: MergeSummary } {
  const managed = ['tspdt', 'ss2022', 'afi', 'criterion', 'worst200', ...FESTIVAL_TAGS]
  const next: Film[] = films.map((f) => ({
    ...f,
    tspdtRank: undefined,
    lists: f.lists.filter((l) => !managed.includes(l)),
  }))

  const summary: MergeSummary = {
    tspdt: mergeList(next, TSPDT, 'tspdt', { setTspdtRank: true }),
    ss2022: mergeList(next, SS2022, 'ss2022'),
    afi: mergeList(next, AFI, 'afi'),
    criterion: mergeList(next, CRITERION, 'criterion'),
    worst200: mergeList(next, WORST200, 'worst200'),
  }
  for (const tag of FESTIVAL_TAGS) {
    summary[tag] = mergeList(next, FESTIVALS[tag] ?? [], tag)
  }
  return { films: next, summary }
}
