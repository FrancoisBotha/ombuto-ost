/*
 * Tree -> SVG string. A pure function: data in, markup out, no DOM.
 *
 * The drawing follows the canvas (OstNode.vue, OstEdge.vue): the same layout, frames, type labels,
 * status badges, confidence, value and priority marks — without the interactive controls and view
 * states (selection, search, collapse). The result is self-contained: literal colours, a system
 * font fallback, no external references, and every piece of user text XML-escaped.
 */
import { edgeKind } from '@/ost/canvas/canvas-model';
import { statusTone } from '@/ost/domain/derive';
import { type Placed, edgePath, layoutTree } from '@/ost/domain/layout';
import { TYPE_BOX } from '@/ost/domain/rules';
import type { NodeType, OstNode } from '@/ost/domain/types';

import { EXPORT_PALETTE, type ExportPalette, priorityHex } from './palette';
import { EXPORT_FONT_FAMILY, type FontSpec, type MeasureText, escapeXml, estimateTextWidth, textWidth, wrapText } from './text';

export interface TreeSvgOptions {
  /** Shown as the image's title (accessible name). */
  title?: string;
  /** Space around the tree, px. */
  padding?: number;
  /** Text measurer; defaults to an estimate that needs no browser. */
  measure?: MeasureText;
  palette?: ExportPalette;
}

export interface TreeSvg {
  svg: string;
  /** Size in CSS px (the SVG's width / height attributes). */
  width: number;
  height: number;
}

export const DEFAULT_PADDING = 40;

// ---- node metrics (keep in sync with OstNode.vue) ---------------------------------------------
const BORDER = 1;
const PAD_TOP = 9;
const PAD_X = 11;
const PAD_BOTTOM = 8;
/** Opportunities keep the right edge free for the priority dots. */
const OPPORTUNITY_PAD_RIGHT = 20;
const RADIUS = 8;
/** Inter's ascent as a share of the font size (its content area is 1.21em). */
const ASCENT = 0.969;
const NORMAL_LINE = 1.21;

const KICKER: FontSpec = { size: 9, weight: 400, letterSpacing: 0.72 };
const KICKER_LINE = 11;
const TITLE_GAP = 6;
const TITLE_SIZE = 15;
const TITLE_LINE = 17.7;
/** Types with a two-line meta row get two title lines, the others three (as on the canvas). */
const TITLE_LINES: Record<NodeType, number> = { project: 2, outcome: 3, opportunity: 3, solution: 2, assumption: 2, evidence: 3 };
const META_GAP = 6;
const ITEM_GAP = 5;
const BADGE: FontSpec = { size: 10, weight: 400, letterSpacing: 0.6 };
const BADGE_PAD_X = 7;
const BADGE_H = 18;
const METRIC: FontSpec = { size: 10, weight: 400, letterSpacing: 0.8 };
const METRIC_LINE = 12;
const MONEY: FontSpec = { size: 11, weight: 400, letterSpacing: -0.44 };
const MONEY_H = 13;
/** A little slack so a viewer's fallback font does not push text over the frame. */
const FIT_SLACK = 2;

/** Numbers as short attribute values. */
const num = (value: number): string => String(Math.round(value * 100) / 100);

const attrs = (values: Record<string, string | number | undefined>): string =>
  Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${typeof value === 'number' ? num(value) : escapeXml(value!)}"`)
    .join('');

interface TextOptions {
  fill: string;
  opacity?: number;
}

/** One line of text; `y` is the baseline. */
const textEl = (x: number, y: number, font: FontSpec, content: string, options: TextOptions): string =>
  `<text${attrs({
    x,
    y,
    'font-size': font.size,
    'font-weight': font.weight === 400 ? undefined : font.weight,
    'font-style': font.italic ? 'italic' : undefined,
    'letter-spacing': font.letterSpacing,
    fill: options.fill,
    'fill-opacity': options.opacity,
  })}>${content}</text>`;

/** Baseline of the first line of a text block whose line box starts at `top`. */
const baseline = (top: number, lineHeight: number, size: number): number => top + (lineHeight - NORMAL_LINE * size) / 2 + ASCENT * size;

interface Frame {
  fill: string;
  stroke: string;
  dashed?: boolean;
}

const frameOf = (type: NodeType, p: ExportPalette): Frame =>
  ({
    project: { fill: p.accent[900], stroke: p.accent[700] },
    outcome: { fill: p.accent[900], stroke: p.accent[600] },
    opportunity: { fill: p.surface, stroke: p.accent[500] },
    solution: { fill: p.neutral[900], stroke: p.neutral[700] },
    // Transparent on the canvas: the ground shows through. Filled with the ground here, so an edge
    // never shows through a node.
    assumption: { fill: p.bg, stroke: p.accent[500], dashed: true },
    evidence: { fill: p.bg, stroke: p.neutral[800] },
  })[type];

const edgeStroke = (childType: NodeType, p: ExportPalette): Record<string, string | number | undefined> =>
  ({
    spine: { stroke: p.accent[600], 'stroke-width': 1.6 },
    solution: { stroke: p.accent[600], 'stroke-width': 1.1 },
    test: { stroke: p.accent[600], 'stroke-width': 1.1, 'stroke-dasharray': '4 4' },
    evidence: { stroke: p.neutral[700], 'stroke-width': 1.1, 'stroke-dasharray': '4 4' },
  })[edgeKind(childType)];

const badgeColours = (status: string, p: ExportPalette): { fill: string; stroke: string; text: string } =>
  ({
    good: { fill: p.accent[800], stroke: 'none', text: p.accent[200] },
    flight: { fill: 'none', stroke: p.accent[600], text: p.accent[300] },
    bad: { fill: p.neutral[900], stroke: 'none', text: p.neutral[300] },
  })[statusTone(status)];

/** What one node draws, measured before anything is written (its height depends on its text). */
interface NodePlan {
  node: OstNode;
  /** Top-left corner and final size; a long title makes a node taller than its layout box. */
  x: number;
  y: number;
  w: number;
  h: number;
  titleLines: string[];
  titleFont: FontSpec;
  badge: { label: string; w: number } | null;
  metricLines: string[];
  money: number | null;
  metaH: number;
}

function planNode(node: OstNode, placed: Placed, measure: MeasureText): NodePlan {
  const isOpportunity = node.type === 'opportunity';
  const innerW = placed.w - 2 * BORDER - PAD_X - (isOpportunity ? OPPORTUNITY_PAD_RIGHT : PAD_X);
  const titleFont: FontSpec = { size: TITLE_SIZE, weight: 600, italic: node.type === 'evidence' };
  const titleLines = wrapText(node.title, innerW - FIT_SLACK, TITLE_LINES[node.type], text => textWidth(text, titleFont, measure));
  if (!titleLines.length) titleLines.push('');

  let badge: NodePlan['badge'] = null;
  let metricLines: string[] = [];
  let money: number | null = null;
  if (node.type !== 'project') {
    if (node.status) {
      const label = node.status.toUpperCase();
      badge = { label, w: Math.min(innerW, textWidth(label, BADGE, measure) + 2 * BADGE_PAD_X + 2 * BORDER) };
    }
    if (node.type === 'assumption') {
      const room = innerW - (badge ? badge.w + ITEM_GAP : 0) - FIT_SLACK;
      // Wraps ("40%" / "confidence") beside a wide badge, as it does on the canvas.
      metricLines = wrapText(`${node.conf}% confidence`, room, 2, text => textWidth(text, METRIC, measure));
    } else if (isOpportunity) {
      money = Math.min(5, Math.max(0, Math.round(node.value || 0)));
    }
  }
  const metaH = Math.max(badge ? BADGE_H : 0, metricLines.length * METRIC_LINE, money === null ? 0 : MONEY_H);
  const content = KICKER_LINE + TITLE_GAP + titleLines.length * TITLE_LINE + (node.type === 'project' ? 0 : META_GAP + metaH);
  const h = Math.max(placed.h, Math.ceil(2 * BORDER + PAD_TOP + content + PAD_BOTTOM));
  return { node, x: placed.x - placed.w / 2, y: placed.y, w: placed.w, h, titleLines, titleFont, badge, metricLines, money, metaH };
}

/** Five dots, top = highest band; each fills over its 20-point band and grows 4.5 -> 7px. */
function priorityDots(plan: NodePlan, p: ExportPalette): string {
  const priority = plan.node.priority;
  const dots = [5, 4, 3, 2, 1].map(step => {
    const fill = Math.max(0, Math.min(1, (priority - (step - 1) * 20) / 20));
    return { fill, size: 4.5 + fill * 2.5 };
  });
  const gap = 4;
  const total = dots.reduce((sum, dot) => sum + dot.size, 0) + gap * (dots.length - 1);
  const top = plan.y + BORDER + 24;
  const bottom = plan.y + plan.h - BORDER - 9;
  const cx = plan.x + plan.w - BORDER - 6 - 3.5;
  let y = top + (bottom - top - total) / 2;
  const colour = priorityHex(priority);
  return dots
    .map(dot => {
      const cy = y + dot.size / 2;
      y += dot.size + gap;
      return dot.fill > 0
        ? `<circle${attrs({ cx, cy, r: dot.size / 2, fill: colour, 'fill-opacity': 0.35 + dot.fill * 0.65 })}/>`
        : `<circle${attrs({ cx, cy, r: dot.size / 2, fill: p.neutral[800] })}/>`;
    })
    .join('');
}

function drawNode(plan: NodePlan, p: ExportPalette): string {
  const { node, x, y, w, h } = plan;
  const frame = frameOf(node.type, p);
  const left = x + BORDER + PAD_X;
  const parts: string[] = [
    // Inset by half the stroke so the 1px frame sits on whole pixels.
    `<rect${attrs({
      x: x + 0.5,
      y: y + 0.5,
      width: w - 1,
      height: h - 1,
      rx: RADIUS - 0.5,
      fill: frame.fill,
      stroke: frame.stroke,
      'stroke-dasharray': frame.dashed ? '4 3' : undefined,
    })}/>`,
  ];

  const blockH = KICKER_LINE + TITLE_GAP + plan.titleLines.length * TITLE_LINE;
  // A project's label and title sit in the middle of the box; every other type starts at the top.
  const blockTop =
    node.type === 'project' ? y + BORDER + PAD_TOP + (h - 2 * BORDER - PAD_TOP - PAD_BOTTOM - blockH) / 2 : y + BORDER + PAD_TOP;
  parts.push(
    textEl(left, baseline(blockTop, KICKER_LINE, KICKER.size), KICKER, escapeXml(TYPE_BOX[node.type].label.toUpperCase()), {
      fill: p.text,
      opacity: 0.7,
    }),
  );
  const titleTop = blockTop + KICKER_LINE + TITLE_GAP;
  plan.titleLines.forEach((line, i) => {
    parts.push(
      textEl(left, baseline(titleTop + i * TITLE_LINE, TITLE_LINE, TITLE_SIZE), plan.titleFont, escapeXml(line), { fill: p.text }),
    );
  });

  if (plan.metaH > 0) {
    const rowMid = y + h - BORDER - PAD_BOTTOM - plan.metaH / 2;
    let cursor = left;
    if (plan.badge) {
      const colours = badgeColours(node.status, p);
      parts.push(
        `<rect${attrs({
          x: cursor + 0.5,
          y: rowMid - BADGE_H / 2 + 0.5,
          width: plan.badge.w - 1,
          height: BADGE_H - 1,
          rx: 3.5,
          fill: colours.fill,
          stroke: colours.stroke === 'none' ? undefined : colours.stroke,
        })}/>`,
        textEl(cursor + BORDER + BADGE_PAD_X, baseline(rowMid - BADGE_H / 2 + 3, 12, BADGE.size), BADGE, escapeXml(plan.badge.label), {
          fill: colours.text,
        }),
      );
      cursor += plan.badge.w + ITEM_GAP;
    }
    const metricTop = rowMid - (plan.metricLines.length * METRIC_LINE) / 2;
    plan.metricLines.forEach((line, i) => {
      parts.push(
        textEl(cursor, baseline(metricTop + i * METRIC_LINE, METRIC_LINE, METRIC.size), METRIC, escapeXml(line), {
          fill: p.text,
          opacity: 0.7,
        }),
      );
    });
    if (plan.money !== null) {
      const on = `<tspan fill="${p.accent[300]}">${'$'.repeat(plan.money)}</tspan>`;
      const off = `<tspan fill="${p.neutral[700]}">${'$'.repeat(5 - plan.money)}</tspan>`;
      parts.push(textEl(cursor, baseline(rowMid - MONEY_H / 2, MONEY_H, MONEY.size), MONEY, on + off, { fill: p.text }));
    }
  }

  if (node.type === 'opportunity') parts.push(priorityDots(plan, p));
  return `<g>${parts.join('')}</g>`;
}

/**
 * Draws the whole tree under `rootIds` (every project of the view, nothing collapsed) as a
 * standalone SVG document. Returns null when there is nothing to draw.
 */
export function treeToSvg(nodes: OstNode[], rootIds: string[], options: TreeSvgOptions = {}): TreeSvg | null {
  const palette = options.palette ?? EXPORT_PALETTE;
  const measure = options.measure ?? estimateTextWidth;
  const padding = options.padding ?? DEFAULT_PADDING;

  const placed = layoutTree(nodes, { roots: rootIds, collapsed: {} });
  const visible = nodes.filter(n => placed[n.id]);
  if (!visible.length) return null;

  const plans = visible.map(n => planNode(n, placed[n.id], measure));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const plan of plans) {
    minX = Math.min(minX, plan.x);
    minY = Math.min(minY, plan.y);
    maxX = Math.max(maxX, plan.x + plan.w);
    maxY = Math.max(maxY, plan.y + plan.h);
  }
  const width = Math.ceil(maxX - minX + 2 * padding);
  const height = Math.ceil(maxY - minY + 2 * padding);

  const edges = visible
    .filter(n => n.parent && placed[n.parent])
    .map(n => `<path${attrs({ d: edgePath(placed[n.parent!], placed[n.id]), ...edgeStroke(n.type, palette) })}/>`);

  const title = options.title?.trim();
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"${attrs({ width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' })}>`,
    title ? `<title>${escapeXml(title)}</title>` : '',
    `<rect${attrs({ width, height, fill: palette.bg })}/>`,
    `<g${attrs({ transform: `translate(${num(padding - minX)} ${num(padding - minY)})`, 'font-family': EXPORT_FONT_FAMILY })}>`,
    `<g fill="none">${edges.join('')}</g>`,
    ...plans.map(plan => drawNode(plan, palette)),
    `</g>`,
    `</svg>`,
  ]
    .filter(Boolean)
    .join('\n');
  return { svg: `${svg}\n`, width, height };
}
