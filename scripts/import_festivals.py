#!/usr/bin/env python3
"""Build src/data/festivals.json: top-prize winners of Cannes, Berlin, Venice,
TIFF, and Sundance.

Sources: Wikidata SPARQL (award received, P166) for everything except TIFF,
whose Wikidata coverage is poor — that one is parsed from Wikipedia's
People's Choice Award page instead.

Usage: python3 scripts/import_festivals.py
"""

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'src' / 'data' / 'festivals.json'
UA = {'User-Agent': 'cine-roulette/1.0 (personal project)'}

AWARDS = {
    'cannes': ['Q179808'],  # Palme d'Or
    'berlin': ['Q154590'],  # Golden Bear
    'venice': ['Q209459'],  # Golden Lion
    'sundance': ['Q3774974', 'Q15974895'],  # Grand Jury Prize (US Dramatic + general)
}


def sparql_award(qids):
    values = ' '.join(f'wd:{q}' for q in qids)
    query = f"""
SELECT ?filmLabel ?date ?directorLabel WHERE {{
  VALUES ?award {{ {values} }}
  ?film wdt:P166 ?award .
  OPTIONAL {{ ?film wdt:P577 ?date }}
  OPTIONAL {{ ?film wdt:P57 ?director }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
"""
    url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode(
        {'query': query, 'format': 'json'}
    )
    data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))

    films = {}
    for b in data['results']['bindings']:
        title = b.get('filmLabel', {}).get('value', '')
        if not title or (title.startswith('Q') and title[1:].isdigit()):
            continue
        date = b.get('date', {}).get('value', '')
        year = int(date[:4]) if date[:4].isdigit() else None
        director = b.get('directorLabel', {}).get('value', '')
        cur = films.setdefault(title.lower(), {'title': title, 'year': year, 'director': director})
        if director and director not in cur['director']:
            cur['director'] = (cur['director'] + ' & ' + director) if cur['director'] else director
        if year and (not cur['year'] or year < cur['year']):
            cur['year'] = year
    return sorted((f for f in films.values() if f['year']), key=lambda x: x['year'])


def tiff_from_wikipedia():
    url = (
        'https://en.wikipedia.org/w/api.php?action=parse'
        '&page=Toronto_International_Film_Festival_People%27s_Choice_Award'
        '&prop=wikitext&format=json'
    )
    data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
    txt = data['parse']['wikitext']['*']
    winners = []
    for row in re.split(r'\n\|-', txt):
        ym = re.search(r'\[\[(\d{4}) Toronto International Film Festival\|', row)
        fm = re.search(r"'''''\[\[(?:[^|\]]*\|)?([^\]]+)\]\]'''''", row)
        if not ym or not fm:
            continue
        dm = re.search(r"'''\[\[(?:[^|\]]*\|)?([^\]]+)\]\]'''", row.split("'''''")[-1])
        winners.append(
            {'title': fm.group(1), 'year': int(ym.group(1)), 'director': dm.group(1) if dm else ''}
        )
    return sorted(winners, key=lambda x: x['year'])


def main():
    out = {}
    for key, qids in AWARDS.items():
        out[key] = sparql_award(qids)
        print(key, len(out[key]))
        time.sleep(1)
    out['tiff'] = tiff_from_wikipedia()
    print('tiff', len(out['tiff']))
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
