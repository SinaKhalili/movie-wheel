export default function Footer() {
  return (
    <footer className="border-t border-[var(--line)] px-4 py-8 text-center">
      <p className="mb-0 mt-0 text-sm text-[var(--ink-dim)]">
        made with 📹 by{' '}
        <a href="https://sina.town" target="_blank" rel="noreferrer">
          sina k.
        </a>{' '}
        if you like this, you might also like{' '}
        <a href="https://kino.sina.town" target="_blank" rel="noreferrer">
          kino.sina.town
        </a>{' '}
        or other projects at{' '}
        <a href="https://sina.town" target="_blank" rel="noreferrer">
          sina.town
        </a>{' '}
        :^) — open source on{' '}
        <a href="https://github.com/SinaKhalili/movie-wheel" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </p>
      <p className="mb-0 mt-2 text-xs text-[var(--ink-faint)]">
        Film data from{' '}
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          TMDB
        </a>{' '}
        · streaming availability powered by{' '}
        <a href="https://www.justwatch.com" target="_blank" rel="noreferrer">
          JustWatch
        </a>{' '}
        · rankings from{' '}
        <a href="https://theyshootpictures.com" target="_blank" rel="noreferrer">
          TSPDT
        </a>{' '}
        and{' '}
        <a href="https://www.bfi.org.uk/sight-and-sound" target="_blank" rel="noreferrer">
          Sight &amp; Sound
        </a>
        . This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </footer>
  )
}
