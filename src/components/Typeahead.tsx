import { useEffect, useRef, useState } from 'react'

/**
 * Styled autocomplete input — replaces native <datalist>, which can't be
 * themed. Arrow keys + Enter to pick, Escape to dismiss.
 */
export default function Typeahead({
  options,
  value,
  onChange,
  onPick,
  placeholder,
  className,
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
  /** called with the chosen option (or the raw text on Enter with no match) */
  onPick: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const q = value.trim().toLowerCase()
  const matches = q
    ? options
        .filter((o) => o.toLowerCase().includes(q))
        .sort((a, b) => {
          const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1
          const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1
          return aStarts - bStarts || a.localeCompare(b)
        })
        .slice(0, 8)
    : []

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (v: string) => {
    onPick(v)
    setOpen(false)
    setActive(0)
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <input
        className="field"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (open && matches[active]) pick(matches[active])
            else if (value.trim()) pick(value.trim())
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="card absolute left-0 right-0 top-full z-20 m-0 mt-1 list-none overflow-hidden !rounded-lg p-1">
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  i === active
                    ? 'bg-[rgba(217,154,61,0.18)] text-[var(--gold-bright)]'
                    : 'text-[var(--ink)] hover:bg-[rgba(217,154,61,0.1)]'
                }`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(m)
                }}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
