import { useCallback, useEffect, useState } from 'react'
import { guessRegion } from './api'
import { SHIPPED, SHIPPED_FILMS } from './films'
import { idbGet, idbSet } from './idb'
import type { Film } from './types'

/**
 * localStorage-backed state. SSR and the first client render use `initial`;
 * the stored value is swapped in after hydration.
 */
export function usePersisted<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw != null) setValue(JSON.parse(raw) as T)
    } catch {
      // corrupted value — fall back to initial
    }
    setHydrated(true)
  }, [key])

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          window.localStorage.setItem(key, JSON.stringify(v))
        } catch {
          // storage full or unavailable — keep in-memory state
        }
        return v
      })
    },
    [key],
  )

  return [value, set, hydrated]
}

// films key bumped whenever the shipped snapshot changes shape (v3: festival lists)
export const FILMS_KEY = 'wheel.films.v3'
export const SLICES_KEY = 'wheel.slices.v4'
export const MUTED_KEY = 'wheel.muted.v1'
export const REGION_KEY = 'wheel.region.v1'

/**
 * The film library — same contract as usePersisted, but backed by IndexedDB
 * because ~20k films exceed localStorage quotas.
 */
export function useFilmLibrary(): [Film[], (next: Film[] | ((prev: Film[]) => Film[])) => void, boolean] {
  const [films, setFilms] = useState<Film[]>(SHIPPED_FILMS)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    idbGet<Film[]>(FILMS_KEY)
      .then((stored) => {
        if (!cancelled && stored && stored.length > 0) setFilms(stored)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const set = useCallback((next: Film[] | ((prev: Film[]) => Film[])) => {
    setFilms((prev) => {
      const v = typeof next === 'function' ? next(prev) : next
      void idbSet(FILMS_KEY, v).catch(() => {})
      return v
    })
  }, [])

  return [films, set, hydrated]
}

export function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * Age of the shipped snapshot's streaming data in days. null until mounted
 * (so SSR and the first client render agree).
 */
export function useSnapshotAge(): number | null {
  const [days, setDays] = useState<number | null>(null)
  useEffect(() => setDays(daysSince(SHIPPED.generatedAt)), [])
  return days
}

/**
 * Watch region (ISO 3166-1 alpha-2). Defaults from the visitor's IP country
 * (Cloudflare's cf-ipcountry header) until the user picks one explicitly.
 */
export function useRegion(): [string, (r: string) => void] {
  const [region, setRegion, hydrated] = usePersisted<string | null>(REGION_KEY, null)

  useEffect(() => {
    if (hydrated && region == null) {
      guessRegion()
        .then((r) => setRegion(r))
        .catch(() => setRegion('CA'))
    }
  }, [hydrated, region, setRegion])

  return [region ?? 'CA', setRegion]
}
