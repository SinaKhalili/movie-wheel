import type { Slice } from './types'
import { uid } from './types'

export const DEFAULT_SLICES: Slice[] = [
  { id: uid(), type: 'filter', label: 'Mubi night', conditions: [{ kind: 'service', services: ['mubi'] }] },
  {
    id: uid(),
    type: 'filter',
    label: 'Anything on Mubi',
    conditions: [{ kind: 'service', services: ['mubi'] }],
    scope: 'catalog',
  },
  {
    id: uid(),
    type: 'filter',
    label: 'Criterion Channel',
    conditions: [{ kind: 'service', services: ['criterion-channel'] }],
  },
  { id: uid(), type: 'filter', label: 'The canon (TSPDT)', conditions: [{ kind: 'list', lists: ['tspdt'] }] },
  { id: uid(), type: 'filter', label: 'Anything 70s', conditions: [{ kind: 'year', from: 1970, to: 1979 }] },
  // film ids are tmdb-derived (`t<id>`) — 843 is In the Mood for Love
  { id: uid(), type: 'film', filmId: 't843' },
  { id: uid(), type: 'filter', label: 'Kurosawa', conditions: [{ kind: 'director', directors: ['Akira Kurosawa'] }] },
  { id: uid(), type: 'text', text: 'Dealer’s choice' },
  { id: uid(), type: 'text', text: 'Rewatch an old favorite' },
]
