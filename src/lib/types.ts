export type Film = {
  id: string
  title: string
  year: number
  director: string
  country: string
  /** service ids, e.g. 'mubi' */
  services: string[]
  /** list ids, e.g. 'tspdt' */
  lists: string[]
  tmdbId?: number
  /** 'tv' for TV-roulette picks; absent/undefined means a movie. */
  mediaType?: 'tv'
  /** TMDB poster path, e.g. '/abc.jpg' */
  poster?: string
  /** position on the TSPDT 1,000 Greatest Films */
  tspdtRank?: number
}

export type Condition =
  | { kind: 'director'; directors: string[] }
  | { kind: 'year'; from?: number; to?: number }
  | { kind: 'country'; countries: string[] }
  | { kind: 'service'; services: string[] }
  | { kind: 'list'; lists: string[] }
  | { kind: 'rank'; max?: number }

export type ConditionKind = Condition['kind']

export type Slice =
  | { id: string; type: 'film'; filmId: string; muted?: boolean }
  | { id: string; type: 'text'; text: string; muted?: boolean }
  | {
      id: string
      type: 'filter'
      label: string
      conditions: Condition[]
      /**
       * 'library' (default) matches films in your library; 'catalog' asks
       * TMDB live for *everything* on the chosen services (service & year
       * conditions only).
       */
      scope?: 'library' | 'catalog'
      /** kept in the lineup but skipped when building the wheel */
      muted?: boolean
    }

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}
