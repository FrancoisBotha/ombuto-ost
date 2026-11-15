/*
 * Literal colours for exported images.
 *
 * CSS variables do not survive outside the page, so an exported SVG needs plain hex values. They
 * are read from the text of theme.css (the one place the palette's hex is written), so the export
 * can never drift from the canvas.
 */
import themeCss from '@/ost/styles/theme.css?raw';

import { NODE_COLORS, type NodeColor } from '@/ost/domain/node-colors';
import { priorityColor } from '@/ost/domain/rules';

const RAMP_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
type RampStep = (typeof RAMP_STEPS)[number];
export type Ramp = Record<RampStep, string>;

/** The two colours of a node tint: its background and its border. */
export interface Tint {
  fill: string;
  edge: string;
}

export interface ExportPalette {
  /** The canvas ground. */
  bg: string;
  surface: string;
  text: string;
  accent: Ramp;
  neutral: Ramp;
  /** The colours a node can be given, by name (node-colors.ts). */
  tints: Record<NodeColor, Tint>;
}

/** Every `--ost-<name>: #rrggbb` declaration of a stylesheet, by name. */
export function parsePigments(css: string): Map<string, string> {
  const pigments = new Map<string, string>();
  for (const match of css.matchAll(/--ost-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\b/gi)) pigments.set(match[1], match[2].toLowerCase());
  return pigments;
}

export function buildPalette(css: string): ExportPalette {
  const pigments = parsePigments(css);
  const need = (name: string): string => {
    const hex = pigments.get(name);
    if (!hex) throw new Error(`The colour "${name}" is missing from the theme.`);
    return hex;
  };
  const ramp = (name: string) => Object.fromEntries(RAMP_STEPS.map(step => [step, need(`${name}-${step}`)])) as Ramp;
  return {
    bg: need('nocturne-ground'),
    surface: need('nocturne-surface'),
    text: need('nocturne-text'),
    accent: ramp('accent'),
    neutral: ramp('neutral'),
    tints: Object.fromEntries(
      NODE_COLORS.map(name => [name, { fill: need(`tint-${name}-fill`), edge: need(`tint-${name}-edge`) }]),
    ) as Record<NodeColor, Tint>,
  };
}

export const EXPORT_PALETTE: ExportPalette = buildPalette(themeCss);

const toByte = (linear: number): number => {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
};

/** OKLCH (lightness 0-1, chroma, hue in degrees) as an sRGB hex colour, clipped to the gamut. */
export function oklchToHex(l: number, c: number, h: number): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  return `#${rgb.map(v => toByte(v).toString(16).padStart(2, '0')).join('')}`;
}

/** The priority colour of the canvas (`priorityColor`, an `oklch()` value) as hex. */
export function priorityHex(priority: number): string {
  const parts = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/.exec(priorityColor(priority));
  if (!parts) throw new Error('The priority colour could not be read.');
  return oklchToHex(Number(parts[1]), Number(parts[2]), Number(parts[3]));
}
