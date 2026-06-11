#!/usr/bin/env python3
"""Convert TSPDT's official 1,000 Greatest Films spreadsheet into src/data/tspdt1000.json.

Usage:
  curl -sL -o /tmp/tspdt.xls "https://theyshootpictures.com/resources/1000GreatestFilms.xls"
  python3 scripts/import_tspdt.py /tmp/tspdt.xls

Requires: pip3 install xlrd
"""

import json
import re
import sys
from pathlib import Path

import xlrd


def fix_director(raw: str) -> str:
    # "Welles, Orson" -> "Orson Welles"; "Coen, Joel & Ethan Coen" -> "Joel Coen & Ethan Coen"
    raw = raw.strip()
    if ',' not in raw:
        return raw
    last, rest = raw.split(',', 1)
    rest = rest.strip()
    if '&' in rest:
        first, others = rest.split('&', 1)
        return f"{first.strip()} {last.strip()} & {others.strip()}"
    return f"{rest} {last.strip()}"


def fix_year(raw) -> int:
    if isinstance(raw, float):
        return int(raw)
    m = re.search(r'\d{4}', str(raw))
    return int(m.group(0)) if m else 0


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else '/tmp/tspdt.xls'
    out = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'tspdt1000.json'
    sheet = xlrd.open_workbook(src).sheet_by_index(0)

    films = []
    for r in range(1, sheet.nrows):
        row = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
        films.append(
            {
                'rank': int(row[0]),
                'title': str(row[3]).strip(),
                'director': fix_director(str(row[4])),
                'year': fix_year(row[5]),
                'country': str(row[6]).split('-')[0].strip(),
            }
        )

    films.sort(key=lambda x: x['rank'])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(films, ensure_ascii=False, indent=None, separators=(',', ':')))
    print(f'wrote {len(films)} films -> {out}')


if __name__ == '__main__':
    main()
