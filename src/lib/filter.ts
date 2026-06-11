import type { Condition, Film } from './types'
import { listName, serviceName } from './films'

export function matchesCondition(film: Film, c: Condition): boolean {
  switch (c.kind) {
    case 'director':
      return c.directors.length === 0 || c.directors.includes(film.director)
    case 'year':
      return (c.from == null || film.year >= c.from) && (c.to == null || film.year <= c.to)
    case 'country':
      return c.countries.length === 0 || c.countries.includes(film.country)
    case 'service':
      return c.services.length === 0 || c.services.some((s) => film.services.includes(s))
    case 'list':
      return c.lists.length === 0 || c.lists.some((l) => film.lists.includes(l))
    case 'rank':
      return film.tspdtRank != null && (c.max == null || film.tspdtRank <= c.max)
  }
}

/** All conditions must hold (AND); within a condition, listed values are OR'd. */
export function matchFilms(films: Film[], conditions: Condition[]): Film[] {
  return films.filter((film) => conditions.every((c) => matchesCondition(film, c)))
}

export function conditionSummary(c: Condition): string {
  switch (c.kind) {
    case 'director':
      return c.directors.length ? `by ${c.directors.join(' or ')}` : 'by any director'
    case 'year': {
      if (c.from != null && c.to != null) return `${c.from}–${c.to}`
      if (c.from != null) return `from ${c.from}`
      if (c.to != null) return `until ${c.to}`
      return 'any year'
    }
    case 'country':
      return c.countries.length ? `from ${c.countries.join(' or ')}` : 'any country'
    case 'service':
      return c.services.length
        ? `on ${c.services.map(serviceName).join(' or ')}`
        : 'on any service'
    case 'list':
      return c.lists.length ? `in ${c.lists.map(listName).join(' or ')}` : 'in any list'
    case 'rank':
      return c.max != null ? `TSPDT top ${c.max}` : 'ranked on TSPDT'
  }
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
