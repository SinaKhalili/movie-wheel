import type { Slice } from './types'
import { uid } from './types'

/**
 * The default lineup doubles as a feature tour: single conditions, AND-combos
 * (country + list + service), OR within a condition, TSPDT rank, a whole-
 * catalog slice, a director, and one specific film.
 */
export const DEFAULT_SLICES: Slice[] = [
  {
    id: uid(),
    type: 'filter',
    label: 'Tonight on Mubi',
    conditions: [{ kind: 'service', services: ['mubi'] }],
  },
  {
    id: uid(),
    type: 'filter',
    label: 'All of Mubi',
    conditions: [{ kind: 'service', services: ['mubi'] }],
    scope: 'catalog',
  },
  {
    id: uid(),
    type: 'filter',
    label: 'Top 100 of all time',
    conditions: [{ kind: 'rank', max: 100 }],
  },
  {
    id: uid(),
    type: 'filter',
    label: 'Festival gold',
    conditions: [{ kind: 'list', lists: ['cannes', 'venice', 'berlin'] }],
  },
  {
    id: uid(),
    type: 'filter',
    label: 'Criterion does Japan',
    conditions: [
      { kind: 'country', countries: ['Japan'] },
      { kind: 'list', lists: ['criterion'] },
      { kind: 'service', services: ['criterion-channel'] },
    ],
  },
  {
    id: uid(),
    type: 'filter',
    label: 'The French ’60s',
    conditions: [
      { kind: 'country', countries: ['France'] },
      { kind: 'year', from: 1958, to: 1973 },
    ],
  },
  {
    id: uid(),
    type: 'filter',
    label: 'A night with Varda',
    conditions: [{ kind: 'director', directors: ['Agnès Varda'] }],
  },
  // film ids are tmdb-derived (`t<id>`) — 843 is In the Mood for Love
  { id: uid(), type: 'film', filmId: 't843' },
]
