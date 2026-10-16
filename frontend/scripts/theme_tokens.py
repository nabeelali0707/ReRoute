"""One-off theme migration for styles.css.

Turns every literal colour into a CSS custom property with a light value (brand
greens rotated to violet; status colours kept) and a derived dark value, so the
app gets a violet brand and a dark mode without hand-editing hundreds of rules.
Run from frontend/:  python scripts/theme_tokens.py
"""
import colorsys
import re

SRC = 'src/styles.css'
# Rules whose colours carry meaning (risk level, success, live state) keep their hue.
STATUS = re.compile(r'risk-|\.success|timeline-event\.success|\.verified|assessment\.ok|green-text|case-dot\.green|approved-note|dispatch-line|live-dot|mode-pill i|check-list li|\.danger|\.error-banner|\.warning|timeline-event\.(warning|error)|reject-button|\.chip\b|pending-reject|replan-alert|\.fail')
HEX = re.compile(r'#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b')
VIOLET_HUE = 262 / 360


def parse(h):
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    rgb = tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return rgb, (h[6:8] if len(h) == 8 else '')


def to_hex(rgb, alpha=''):
    return '#' + ''.join(f'{round(max(0, min(1, c)) * 255):02x}' for c in rgb) + alpha


def light_value(rgb, status):
    h, l, s = colorsys.rgb_to_hls(*rgb)
    if not status and s > 0.05 and 50 / 360 <= h <= 185 / 360:
        # Brand green -> violet at the same lightness; a little extra saturation keeps it lively.
        return colorsys.hls_to_rgb(VIOLET_HUE, l, min(1, s * 1.15 + 0.05))
    return rgb


def dark_value(rgb):
    h, l, s = colorsys.rgb_to_hls(*rgb)
    if s > 0.35 and 0.25 <= l <= 0.7:
        return colorsys.hls_to_rgb(h, min(0.72, l + 0.12), s)  # accents stay recognisable
    nl = 1.06 - l
    nl = 0.11 + (nl - 0.06) * 0.85 if nl < 0.5 else nl  # backgrounds land in a dark but not black band
    return colorsys.hls_to_rgb(h, max(0.08, min(0.94, nl)), s * 0.7)


css = open(SRC, encoding='utf-8').read()
if '--c0:' in css:
    raise SystemExit('Already tokenised.')
tokens = {}  # (light, dark) -> name


def token(light, dark):
    key = (light, dark)
    if key not in tokens:
        tokens[key] = f'--c{len(tokens)}'
    return f'var({tokens[key]})'


def process_rule(match):
    selector, body = match.group(1), match.group(2)
    status = bool(STATUS.search(selector))

    def repl(m):
        rgb, alpha = parse(m.group(1))
        return token(to_hex(light_value(rgb, status), alpha), to_hex(dark_value(light_value(rgb, status)), alpha))
    body = HEX.sub(repl, body)
    body = re.sub(r'(:\s*)white\b', lambda m: m.group(1) + token('#ffffff', to_hex(dark_value((1, 1, 1)))), body)
    return selector + '{' + body + '}'


css = re.sub(r'([^{}]+)\{([^{}]*)\}', process_rule, css)
light = ';'.join(f'{n}:{l}' for (l, d), n in tokens.items())
dark = ';'.join(f'{n}:{d}' for (l, d), n in tokens.items())
header = (f':root{{{light};--surface:#ffffff}}\n'
          f':root[data-theme="dark"]{{color-scheme:dark;{dark};--surface:{to_hex(dark_value((1, 1, 1)))}}}\n')
first_rule = css.index('\n') + 1  # keep the @import first
css = css[:first_rule] + header + css[first_rule:]
open(SRC, 'w', encoding='utf-8').write(css)
print(f'{len(tokens)} colour tokens written')
