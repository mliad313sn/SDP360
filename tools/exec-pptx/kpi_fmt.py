"""A-17b — honest display of verdict KPIs nobody measured (pure, no third-party imports).

render.py replaces every missing KPI with a default (0.0) before drawing. When the payload
carries _unknown_as_dash (report_config exec_payload_zero_policy = 'browser_wins'), the
verdict tiles print an em dash for the keys that arrived as None instead of a fake "0.0%".
Without the flag the text is exactly f"{value:.1f}%" — today's output.
"""

VERDICT_KPIS = ('fcr_rate', 'sla_compliance', 'frt_sla')
DASH = '—'


def unknown_kpis(K):
    """The verdict keys that are missing or None — call BEFORE the defaults are applied."""
    return {k for k in VERDICT_KPIS if K.get(k) is None}


def pct_text(K, key, unknown, fmt='.1f'):
    if K.get('_unknown_as_dash') and key in unknown:
        return DASH
    return format(K[key], fmt) + '%'
