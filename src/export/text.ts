/*
 * Text helpers for exported images: XML escaping, width estimation and wrapping. No DOM needed.
 */

/** The font stack written into an exported SVG: Inter where it is installed, else a system font. */
export const EXPORT_FONT_FAMILY = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface FontSpec {
  /** px */
  size: number;
  weight: number;
  italic?: boolean;
  /** px between characters */
  letterSpacing?: number;
}

/** Width in px of a run of text in a font (without letter spacing). */
export type MeasureText = (text: string, font: FontSpec) => number;

const isXmlChar = (code: number): boolean =>
  code === 0x9 ||
  code === 0xa ||
  code === 0xd ||
  (code >= 0x20 && code <= 0xd7ff) ||
  (code >= 0xe000 && code <= 0xfffd) ||
  (code >= 0x10000 && code <= 0x10ffff);

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Text made safe for XML content and attribute values: markup characters become entities, and
 * characters XML 1.0 forbids (control characters, lone surrogates) are dropped, so user content can
 * neither inject markup nor make the file unreadable.
 */
export function escapeXml(text: string): string {
  let out = '';
  for (const ch of text) {
    if (!isXmlChar(ch.codePointAt(0)!)) continue;
    out += XML_ENTITIES[ch] ?? ch;
  }
  return out;
}

const NARROW = new Set("iIjl.,:;'|!`");
const SEMI_NARROW = new Set('frt()[]{}-/\\"* ');
const WIDE = new Set('mwMW%@');

/** Rough advance width of one character, in em, tuned to Inter (which is wider than most system fonts). */
function emWidth(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code >= 0x300 && code <= 0x36f) return 0; // combining marks
  if (code >= 0x2e80) return 1.05; // CJK, emoji and other full-width glyphs
  if (NARROW.has(ch)) return 0.28;
  if (SEMI_NARROW.has(ch)) return 0.38;
  if (WIDE.has(ch)) return 0.9;
  if (ch >= 'A' && ch <= 'Z') return 0.69;
  if (ch >= '0' && ch <= '9') return 0.64;
  return 0.58;
}

/** Width estimate that needs no browser: good enough to wrap, deliberately a little generous. */
export const estimateTextWidth: MeasureText = (text, font) => {
  let em = 0;
  for (const ch of text) em += emWidth(ch);
  return em * font.size * (font.weight >= 600 ? 1.05 : 1);
};

/** Width of `text` in `font`, letter spacing included. */
export function textWidth(text: string, font: FontSpec, measure: MeasureText): number {
  return measure(text, font) + (font.letterSpacing ?? 0) * [...text].length;
}

const ELLIPSIS = '…';

/**
 * Wraps `text` to lines no wider than `maxWidth`, at most `maxLines` of them. Words too long for a
 * line are broken anywhere; when the text does not fit, the last line ends with an ellipsis.
 */
export function wrapText(text: string, maxWidth: number, maxLines: number, width: (text: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const push = () => {
    lines.push(line);
    line = '';
  };
  for (const word of words) {
    if (lines.length > maxLines) break;
    const joined = line ? `${line} ${word}` : word;
    if (width(joined) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) push();
    if (width(word) <= maxWidth) {
      line = word;
      continue;
    }
    // A single word wider than the line: fill line after line with as many characters as fit.
    for (const ch of word) {
      if (line && width(line + ch) > maxWidth) {
        push();
        if (lines.length > maxLines) break;
      }
      line += ch;
    }
  }
  if (line) push();
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  const last = [...kept[maxLines - 1]];
  while (last.length > 1 && width(last.join('').trimEnd() + ELLIPSIS) > maxWidth) last.pop();
  kept[maxLines - 1] = last.join('').trimEnd() + ELLIPSIS;
  return kept;
}
