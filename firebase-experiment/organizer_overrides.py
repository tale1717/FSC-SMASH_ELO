"""Preserve website organizer edits when the scheduled importer runs again."""
from engine import build, validate_size
from game_reports import attach_reports


def apply_overrides(dashboard, overrides, aliases, original_sources=None):
    if not overrides:
        return dashboard
    names = {p['id']: p['name'] for p in dashboard['players']}
    sources = {}
    for event in dashboard['tournaments']:
        matches = [m for m in dashboard['matches'] if m['tournament'] == event['id']]
        sources[event['slug']] = dict(event=event, participants=list({names[p] for m in matches for p in (m['winner'],m['loser'])}), skipped=event.get('skipped',0), matches=[dict(id=m['id'],order=i+1,winner=names[m['winner']],loser=names[m['loser']],winnerScore=m['winnerScore'],loserScore=m['loserScore']) for i,m in enumerate(matches)])
    if original_sources is not None:
        sources = {s['event']['slug']: s for s in original_sources}
    reports = list(dashboard.get('gameReports', []))
    for override in overrides:
        source = override['source']
        validate_size(source)
        slug = source['event']['slug']
        prior = sources.get(slug)
        old_id = prior['event']['id'] if prior else source['event']['id']
        reports = [r for r in reports if r['tournament'] not in (old_id,source['event']['id'])]
        reports.extend(source.get('reports', []))
        sources[slug] = source
    for slug, source in list(sources.items()):
        event = {k:v for k,v in source['event'].items() if k not in ('sets','skipped')}
        sources[slug] = dict(source, event=event)
    latest = max(overrides, key=lambda o:o.get('updatedAt',''))
    order = latest['source']['event'].get('organizerOrder', [])
    if order:
        ordered = [slug for slug in order if slug in sources]
        ordered.extend(slug for slug in sources if slug not in ordered)
        for index, slug in enumerate(ordered):
            sources[slug]['event'].pop('afterSlug', None)
            if index:
                sources[slug]['event']['afterSlug'] = ordered[index-1]
    result = attach_reports(build(list(sources.values()), aliases), reports)
    if any(r['status'] != 'confirmed' for r in result['gameReports']):
        raise ValueError('Organizer game details need review; no publication made')
    validate_size(result)
    return result
