import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="border-b border-[var(--line)] bg-black/30 px-4 backdrop-blur-sm">
      <div className="mx-auto flex w-[min(1240px,100%)] flex-col items-center gap-x-6 gap-y-2 py-4 sm:flex-row">
        <span className="bulb-strip bulb-strip-fill hidden sm:flex" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} />
          ))}
        </span>

        <Link
          to="/"
          className="marquee-font flex-shrink-0 text-2xl text-[var(--gold-bright)] [text-shadow:0_0_18px_rgba(242,193,120,0.3)]"
        >
          Ciné Roulette
        </Link>

        <span className="bulb-strip bulb-strip-fill hidden sm:flex" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} />
          ))}
        </span>

        <nav className="flex flex-shrink-0 items-center gap-5 text-sm font-semibold">
          <Link
            to="/"
            className="text-[var(--ink-dim)] transition-colors hover:text-[var(--ink)]"
            activeProps={{ className: 'text-[var(--gold-bright)]' }}
            activeOptions={{ exact: true }}
          >
            The Wheel
          </Link>
          <Link
            to="/library"
            className="text-[var(--ink-dim)] transition-colors hover:text-[var(--ink)]"
            activeProps={{ className: 'text-[var(--gold-bright)]' }}
          >
            Library
          </Link>
        </nav>
      </div>
    </header>
  )
}
