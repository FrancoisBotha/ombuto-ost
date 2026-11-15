/*
 * Tree -> Markdown outline. A pure function: data in, text out.
 *
 *   # Document name
 *   ## Project: Title
 *   - **Outcome:** Title
 *     > notes
 *     - **Opportunity:** Title — status: exploring · priority: 82/100 (High) · value: 4/5 (Strong)
 *       - Links:
 *         - [Name](https://…)
 *       - Open questions:
 *         - [ ] …
 *       - **Solution:** …
 *   ### Project: Sub-project title
 *   Sub-project of: Title
 *   - **Outcome:** …
 *
 * Projects are headings, everything else is a bullet. A top-level project (or the focused project,
 * when one is focused) is a `##` heading and each level of nesting goes one heading deeper, down to
 * `######`, where deeper projects stay. Heading depth alone would be ambiguous there, so every
 * project that sits inside another says so on the line under its heading ("Sub-project of: A › B",
 * outermost first). A project's own outcomes come before its sub-projects, so the bullets under a
 * heading always belong to that heading's project.
 *
 * Everything the user typed is escaped, so a title or a note can never change the structure of the
 * outline (or smuggle in HTML).
 */
import { breadcrumb, evidenceStrength } from '@/ost/domain/derive';
import { TYPE_BOX, isSafeLinkUrl, priorityLabel, valueLabel } from '@/ost/domain/rules';
import type { OstNode } from '@/ost/domain/types';

const INDENT = '  ';
/** `##` for the projects the outline starts from; Markdown has no heading below `######`. */
const TOP_HEADING = 2;
const DEEPEST_HEADING = 6;

/** Characters that would be dropped or misread: control characters other than tab and newline. */
const stripControl = (text: string): string =>
  [...text]
    .filter(ch => {
      const code = ch.codePointAt(0)!;
      return code === 0x9 || code === 0xa || (code >= 0x20 && code !== 0x7f);
    })
    .join('');

/** Escapes inline Markdown and HTML in running text. */
export function escapeInline(text: string): string {
  return stripControl(text)
    .replace(/[\\`*_[\]<>~]/g, '\\$&')
    .replace(/&(?=#?\w+;)/g, '\\&');
}

/** A single line of user text: whitespace collapsed, inline syntax escaped. */
export const escapeLine = (text: string): string => escapeInline(text.replace(/\s+/g, ' ').trim());

/** One line of a note: also defuses what would start a block (heading, list item, rule, table). */
function escapeNoteLine(line: string): string {
  return escapeInline(line)
    .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
    .replace(/^([-+=|])/, '\\$1')
    .replace(/^(\d+)([.)])/, '$1\\$2');
}

/**
 * Notes as a block quote. Paragraphs stay paragraphs and single line breaks stay line breaks (two
 * trailing spaces, the form every Markdown reader understands).
 */
export function noteLines(note: string): string[] {
  const lines = stripControl(note)
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim());
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!line) {
      if (out.length && out[out.length - 1] !== '>') out.push('>');
      return;
    }
    out.push(`> ${escapeNoteLine(line)}${lines[i + 1] ? '  ' : ''}`);
  });
  while (out[out.length - 1] === '>') out.pop();
  return out;
}

/** `[Name](url)` for a link the app would make clickable; plain text for anything else. */
export function linkItem(name: string, url: string): string {
  const label = escapeLine(name) || 'Link';
  if (!isSafeLinkUrl(url)) return `${label}: ${escapeLine(url)}`;
  const target = stripControl(url.trim()).replace(/[()<>\\\s]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return `[${label}](${target})`;
}

/** Status and the key fields of the node's type, as "name: value" pairs. `children` are the node's own. */
function fieldsOf(node: OstNode, children: OstNode[]): string[] {
  const fields: string[] = [];
  if (node.status) fields.push(`status: ${escapeLine(node.status)}`);
  if (node.type === 'opportunity') {
    fields.push(`priority: ${node.priority}/100 (${priorityLabel(node.priority)})`);
    fields.push(`value: ${node.value}/5 (${valueLabel(node.value)})`);
  } else if (node.type === 'assumption') {
    fields.push(`confidence: ${node.conf}%`);
    if (node.owner.trim()) fields.push(`owner: ${escapeLine(node.owner)}`);
  } else if (node.type === 'solution') {
    const strength = evidenceStrength(node.id, children);
    if (strength.score !== null) {
      fields.push(
        `evidence strength: ${strength.score}% (${strength.tests} assumption${strength.tests === 1 ? '' : 's'}: ${strength.supported} supported, ${strength.refuted} refuted)`,
      );
    }
  }
  return fields;
}

/** Notes, links and open questions of a node, to sit under its heading or bullet. */
function detailLines(node: OstNode): string[] {
  const lines = noteLines(node.note);
  if (node.links.length) {
    lines.push('- Links:');
    for (const link of node.links) lines.push(`${INDENT}- ${linkItem(link.name, link.url)}`);
  }
  if (node.questions.length) {
    lines.push('- Open questions:');
    for (const question of node.questions) lines.push(`${INDENT}- [${question.done ? 'x' : ' '}] ${escapeLine(question.text)}`);
  }
  return lines;
}

/**
 * The outline of the projects in `rootIds` (in that order) with their sub-projects, headed by the
 * document name. Returns null when none of them exists.
 */
export function treeToMarkdown(name: string, nodes: OstNode[], rootIds: string[]): string | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const children = new Map<string, OstNode[]>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    const bucket = children.get(n.parent);
    if (bucket) bucket.push(n);
    else children.set(n.parent, [n]);
  }
  const roots = rootIds.map(id => byId.get(id)).filter((n): n is OstNode => !!n);
  if (!roots.length) return null;

  const out: string[] = [
    `# ${escapeLine(name) || 'Opportunity Solution Tree'}`,
    '',
    'An Opportunity Solution Tree: project → outcome → opportunity → solution → assumption → evidence.',
    'Each heading is a project. A project inside another project has a deeper heading and a "Sub-project of" line naming the projects it sits in.',
    'Each bullet is one node and the bullets nested under it are its children; quoted text is the notes of the node.',
  ];

  // Depth-first without recursion, for the project sections and for the bullets inside each: a
  // very deep tree must not overflow the stack.
  const sections = roots.map(node => ({ node, level: 0 })).reverse();
  const seen = new Set<string>();
  while (sections.length) {
    const { node: project, level } = sections.pop()!;
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    const heading = '#'.repeat(Math.min(DEEPEST_HEADING, TOP_HEADING + level));
    out.push('', `${heading} ${TYPE_BOX.project.label}: ${escapeLine(project.title)}`, '');
    const within = breadcrumb(project.id, byId);
    if (within.length) out.push(`Sub-project of: ${within.map(p => escapeLine(p.title)).join(' › ')}`, '');
    const details = detailLines(project);
    // A blank line ends the quoted notes, so the list below cannot be read as part of them.
    const noteCount = details.findIndex(line => !line.startsWith('>'));
    if (noteCount > 0) details.splice(noteCount, 0, '');
    else if (noteCount === -1 && details.length) details.push('');
    out.push(...details);

    const own = children.get(project.id) ?? [];
    const subProjects = own.filter(child => child.type === 'project');
    for (let i = subProjects.length - 1; i >= 0; i--) sections.push({ node: subProjects[i], level: level + 1 });

    const stack = own
      .filter(child => child.type !== 'project')
      .map(node => ({ node, depth: 0 }))
      .reverse();
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const pad = INDENT.repeat(depth);
      const kids = children.get(node.id) ?? [];
      const fields = fieldsOf(node, kids);
      out.push(`${pad}- **${TYPE_BOX[node.type].label}:** ${escapeLine(node.title)}${fields.length ? ` — ${fields.join(' · ')}` : ''}`);
      for (const line of detailLines(node)) out.push(`${pad}${INDENT}${line}`);
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], depth: depth + 1 });
    }
    while (out[out.length - 1] === '') out.pop();
  }
  return `${out.join('\n')}\n`;
}
