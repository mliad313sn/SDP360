"""A-17b — honest display of verdict KPIs nobody measured (pure, no third-party imports).

render.py replaces every missing KPI with a default (0.0) before drawing. When the payload
carries _unknown_as_dash (report_config exec_payload_zero_policy = 'browser_wins'), the
verdict tiles print an em dash for the keys that arrived as None instead of a fake "0.0%".
Without the flag the text is exactly f"{value:.1f}%" — today's output.

F-DATA-06 — a rate or a duration the server could not measure (and the browser did not send) arrives as
None and is listed in _null_kpis: it prints an em dash whatever the A-17b flag says, and carries no
target tick. null is "not measured", never 0 %.
"""

VERDICT_KPIS = ('fcr_rate', 'sla_compliance', 'frt_sla')
DASH = '—'


def unknown_kpis(K):
    """The verdict keys that are missing or None — call BEFORE the defaults are applied."""
    return {k for k in VERDICT_KPIS if K.get(k) is None}


# F-DATA-06 — keys the server baseline could not measure and the browser did not supply. The server lists
# them in K['_null_kpis'] (services/reportPayload.js); a payload without the list renders exactly as before.
NULLABLE_KPIS = ('closure_rate', 'sla_compliance', 'frt_sla', 'avg_res_days')


def null_kpis(K):
    """Listed AND still None — call BEFORE the defaults are applied."""
    listed = K.get('_null_kpis') or []
    return {k for k in NULLABLE_KPIS if k in listed and K.get(k) is None}


def is_null(K, key):
    return key in (K.get('_null_set') or ())


def pct_text(K, key, unknown, fmt='.1f'):
    if is_null(K, key):
        return DASH
    if K.get('_unknown_as_dash') and key in unknown:
        return DASH
    return format(K[key], fmt) + '%'


def num_text(K, key, suffix='', fmt=None):
    """A duration / plain number: em dash when not measured, else today's text."""
    if is_null(K, key):
        return DASH
    v = K[key]
    return (format(v, fmt) if fmt else str(v)) + suffix


def verdict_mark(K, key, ok):
    """Target tick: nothing when the figure is not measured (no verdict on nothing)."""
    if is_null(K, key):
        return ''
    return '✓' if ok else '⚠'
