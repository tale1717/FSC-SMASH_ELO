"""Organizer-confirmed complete bracket, ordered by printed match numbers."""
import json
from pathlib import Path


def manual_source():
    return json.loads(Path(__file__).with_name('manual-bracket-6.json').read_text())


def include_manual(sources):
    manual = manual_source()
    slug = manual['event']['slug']
    actual = [s for s in sources if s['event']['slug'] == slug]
    if actual:
        if len(actual) != 1:
            raise ValueError('Duplicate bracket #6 sources')
        return sources
    if not any(s['event']['slug'] == manual['event']['afterSlug'] for s in sources):
        return sources
    return [*sources, manual]


def order_sources(sources, instant):
    normal = [s for s in sources if not s['event'].get('afterSlug')]
    ordered = sorted(normal, key=lambda s: (instant(s['event']['started']), (0, int(s['event']['id'])) if s['event']['id'].isdigit() else (1, s['event']['id'])))
    pending = [s for s in sources if s['event'].get('afterSlug')]
    while pending:
        for source in pending:
            indices = [i for i,s in enumerate(ordered) if s['event']['slug'] == source['event']['afterSlug']]
            if len(indices) == 1:
                ordered.insert(indices[0]+1, source)
                pending.remove(source)
                break
        else:
            raise ValueError('Manual tournament order is missing or ambiguous')
    if len({s['event']['slug'] for s in ordered}) != len(ordered):
        raise ValueError('Duplicate tournament slug')
    return ordered

