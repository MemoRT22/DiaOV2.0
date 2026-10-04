import { neutralTheme } from './neutralTheme';
import type { ThemeConfig } from './types';

const HEX = /^#[0-9a-fA-F]{6}$/;

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * amount)) as RGB;
}

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

const SHADES: Array<[number, RGB, number]> = [
  [50, WHITE, 0.92],
  [100, WHITE, 0.84],
  [200, WHITE, 0.68],
  [300, WHITE, 0.48],
  [400, WHITE, 0.24],
  [500, WHITE, 0],
  [600, BLACK, 0.14],
  [700, BLACK, 0.3],
  [800, BLACK, 0.46],
  [900, BLACK, 0.62],
  [950, BLACK, 0.76],
];

function luminance([r, g, b]: RGB) {
  const ch = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string) {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function readableOn(bg: string) {
  return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, '#0B0F19') ? '#FFFFFF' : '#0B0F19';
}

const rgbVar = (c: RGB) => c.join(' ');

export function themeCssVars(theme: ThemeConfig): Record<string, string> {
  const vars: Record<string, string> = {};
  const ramps = ['primary', 'secondary', 'accent', 'success', 'warning', 'error', 'neutral'] as const;
  for (const name of ramps) {
    const base = hexToRgb(theme.colors[name]);
    for (const [shade, target, amount] of SHADES) {
      vars[`--c-${name}-${shade}`] = rgbVar(mix(base, target, amount));
    }
  }
  const c = theme.colors;
  vars['--surface'] = rgbVar(hexToRgb(c.surface));
  vars['--surface-raised'] = rgbVar(hexToRgb(c.surfaceRaised));
  vars['--surface-sunken'] = rgbVar(hexToRgb(c.background));
  vars['--ink'] = rgbVar(hexToRgb(c.ink));
  vars['--ink-muted'] = rgbVar(hexToRgb(c.inkMuted));
  vars['--ink-inverse'] = rgbVar(hexToRgb(c.background));
  vars['--line'] = rgbVar(hexToRgb(c.line));
  vars['--on-primary'] = rgbVar(hexToRgb(readableOn(c.primary)));
  vars['--on-secondary'] = rgbVar(hexToRgb(readableOn(c.secondary)));
  vars['--on-accent'] = rgbVar(hexToRgb(readableOn(c.accent)));
  vars['--font-display'] = `'${theme.typography.display}', system-ui, sans-serif`;
  vars['--font-body'] = `'${theme.typography.body}', system-ui, sans-serif`;
  vars['--radius'] = `${theme.radius}px`;
  return vars;
}

export type ContrastIssue = { label: string; ratio: number; required: number };

export function contrastIssues(theme: ThemeConfig): ContrastIssue[] {
  const c = theme.colors;
  const checks: Array<[string, string, string, number]> = [
    ['Texto principal sobre fondo', c.ink, c.background, 4.5],
    ['Texto principal sobre tarjetas', c.ink, c.surface, 4.5],
    ['Texto secundario sobre tarjetas', c.inkMuted, c.surface, 4.5],
    ['Texto sobre botón principal', readableOn(c.primary), c.primary, 3],
  ];
  return checks
    .map(([label, fg, bg, required]) => ({ label, ratio: contrastRatio(fg, bg), required }))
    .filter((i) => i.ratio < i.required);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

function mergeStrings<T extends Record<string, string>>(base: T, input: unknown, validate?: (v: string) => boolean): T {
  const out = { ...base };
  if (!isObj(input)) return out;
  for (const key of Object.keys(base) as Array<keyof T>) {
    const v = input[key as string];
    if (typeof v === 'string' && (!validate || validate(v))) out[key] = v as T[keyof T];
  }
  return out;
}

export function normalizeTheme(input: unknown): ThemeConfig {
  const base = neutralTheme;
  if (!isObj(input)) return base;

  const vocabulary = { ...base.vocabulary };
  if (isObj(input.vocabulary)) {
    for (const key of Object.keys(base.vocabulary) as Array<keyof typeof vocabulary>) {
      const t = input.vocabulary[key];
      if (isObj(t)) vocabulary[key] = { one: str(t.one, base.vocabulary[key].one), many: str(t.many, base.vocabulary[key].many) };
    }
  }

  const ranks = base.ranks.map((r, i) => {
    const src = Array.isArray(input.ranks) ? input.ranks[i] : undefined;
    return isObj(src)
      ? { name: str(src.name, r.name), description: str(src.description, r.description), promotion: str(src.promotion, r.promotion) }
      : r;
  });

  const divisions: ThemeConfig['divisions'] = {};
  if (isObj(input.divisions)) {
    for (const [code, v] of Object.entries(input.divisions)) {
      if (isObj(v) && typeof v.color === 'string' && HEX.test(v.color)) divisions[code] = { color: v.color };
    }
  }

  const style = isObj(input.style) ? input.style : {};
  const typography = isObj(input.typography) ? input.typography : {};

  return {
    meta: mergeStrings(base.meta, input.meta),
    colors: mergeStrings(base.colors, input.colors, (v) => HEX.test(v)),
    typography: { display: str(typography.display, base.typography.display), body: str(typography.body, base.typography.body) },
    radius: typeof input.radius === 'number' && input.radius >= 0 && input.radius <= 32 ? input.radius : base.radius,
    style: {
      background: style.background === 'starfield' ? 'starfield' : 'plain',
      glowRing: typeof style.glowRing === 'boolean' ? style.glowRing : base.style.glowRing,
      metallicTitles: typeof style.metallicTitles === 'boolean' ? style.metallicTitles : base.style.metallicTitles,
    },
    assets: mergeStrings(base.assets, input.assets, (v) => v === '' || /^(\/assets\/|https:\/\/)/.test(v)),
    vocabulary,
    ranks,
    texts: mergeStrings(base.texts, input.texts),
    divisions,
  };
}

export function fillTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
