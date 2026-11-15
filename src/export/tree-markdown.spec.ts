import { describe, expect, it } from 'vitest';

import { MAX_DEPTH } from '@/doc/document';
import { node, sampleNodes } from '@/ost/domain/fixtures.test-util';

import { escapeInline, linkItem, noteLines, treeToMarkdown } from './tree-markdown';

const outline = (...args: Parameters<typeof treeToMarkdown>): string => {
  const result = treeToMarkdown(...args);
  if (result === null) throw new Error('nothing written');
  return result;
};

describe('treeToMarkdown', () => {
  it('returns null when there is no project to write', () => {
    expect(treeToMarkdown('Tree', [], [])).toBeNull();
    expect(treeToMarkdown('Tree', sampleNodes(), [])).toBeNull();
    expect(treeToMarkdown('Tree', sampleNodes(), ['project-404'])).toBeNull();
  });

  it('writes the whole outline: a heading per project and a nested bullet per node', () => {
    const nodes = [
      node('project-1', null, { title: 'Meal planner', note: 'The project.' }),
      node('outcome-1', 'project-1', { title: 'More weekly plans' }),
      node('opportunity-1', 'outcome-1', {
        title: 'Deciding takes too long',
        status: 'exploring',
        priority: 82,
        value: 4,
        note: 'Heard in most interviews.',
        links: [{ id: 1, name: 'Interview notes', url: 'https://example.com/notes' }],
        questions: [
          { id: 1, text: 'Worse on weekdays?', done: false },
          { id: 2, text: 'Who decides?', done: true },
        ],
      }),
      node('solution-1', 'opportunity-1', { title: 'Suggest a week', status: 'candidate' }),
      node('assumption-1', 'solution-1', { title: 'People accept suggestions', status: 'supported', conf: 60, owner: 'Research' }),
      node('assumption-2', 'solution-1', { title: 'Meals are logged', status: 'untested', conf: 40 }),
      node('evidence-1', 'assumption-1', { title: '5 of 8 kept four' }),
      node('project-2', null, { title: 'Second project' }),
    ];
    expect(outline('My tree', nodes, ['project-1', 'project-2'])).toBe(
      [
        '# My tree',
        '',
        'An Opportunity Solution Tree: project → outcome → opportunity → solution → assumption → evidence.',
        'Each heading is a project. A project inside another project has a deeper heading and a "Sub-project of" line naming the projects it sits in.',
        'Each bullet is one node and the bullets nested under it are its children; quoted text is the notes of the node.',
        '',
        '## Project: Meal planner',
        '',
        '> The project.',
        '',
        '- **Outcome:** More weekly plans',
        '  - **Opportunity:** Deciding takes too long — status: exploring · priority: 82/100 (High) · value: 4/5 (Strong)',
        '    > Heard in most interviews.',
        '    - Links:',
        '      - [Interview notes](https://example.com/notes)',
        '    - Open questions:',
        '      - [ ] Worse on weekdays?',
        '      - [x] Who decides?',
        '    - **Solution:** Suggest a week — status: candidate · evidence strength: 70% (2 assumptions: 1 supported, 0 refuted)',
        '      - **Assumption:** People accept suggestions — status: supported · confidence: 60% · owner: Research',
        '        - **Evidence:** 5 of 8 kept four',
        '      - **Assumption:** Meals are logged — status: untested · confidence: 40%',
        '',
        '## Project: Second project',
        '',
      ].join('\n'),
    );
  });

  describe('projects inside projects', () => {
    /** App > (Own outcome, Planner > (Plan more > Deciding, Favourites > Remember), Shopping); Other. In tree order. */
    const nested = () => [
      node('project-1', null, { title: 'App', note: 'Top.' }),
      node('outcome-1', 'project-1', { title: 'Own outcome' }),
      node('project-2', 'project-1', { title: 'Planner' }),
      node('outcome-2', 'project-2', { title: 'Plan more' }),
      node('opportunity-1', 'outcome-2', { title: 'Deciding', status: 'exploring' }),
      node('project-3', 'project-2', { title: 'Favourites', note: 'Deep.' }),
      node('outcome-3', 'project-3', { title: 'Remember' }),
      node('project-4', 'project-1', { title: 'Shopping', sortOrder: 1 }),
      node('project-5', null, { title: 'Other', sortOrder: 1 }),
    ];

    it('gives every project a heading, one level deeper per level of nesting, and says what it sits in', () => {
      const text = outline('Tree', nested(), ['project-1', 'project-5']);
      expect(text.split('\n').slice(6).join('\n')).toBe(
        [
          '## Project: App',
          '',
          '> Top.',
          '',
          '- **Outcome:** Own outcome',
          '',
          '### Project: Planner',
          '',
          'Sub-project of: App',
          '',
          '- **Outcome:** Plan more',
          '  - **Opportunity:** Deciding — status: exploring · priority: 50/100 (Medium) · value: 3/5 (Solid)',
          '',
          '#### Project: Favourites',
          '',
          'Sub-project of: App › Planner',
          '',
          '> Deep.',
          '',
          '- **Outcome:** Remember',
          '',
          '### Project: Shopping',
          '',
          'Sub-project of: App',
          '',
          '## Project: Other',
          '',
        ].join('\n'),
      );
    });

    it("lists a project's own outcomes before its sub-projects, so no bullet is read as part of a sub-project", () => {
      // Handed over with the sub-project first: the outline still starts with the project's own outcome.
      const [app, own, ...rest] = nested();
      const text = outline('Tree', [app, ...rest, own], ['project-1']);
      expect(text.indexOf('- **Outcome:** Own outcome')).toBeGreaterThan(text.indexOf('## Project: App'));
      expect(text.indexOf('- **Outcome:** Own outcome')).toBeLessThan(text.indexOf('### Project: Planner'));
    });

    it('a focused sub-project is the top of its outline, and still says where it sits', () => {
      const text = outline('Tree', nested(), ['project-2']);
      expect(text).toContain('\n## Project: Planner\n\nSub-project of: App\n');
      expect(text).toContain('\n### Project: Favourites\n\nSub-project of: App › Planner\n');
      expect(text).toContain('- **Outcome:** Remember');
      for (const outside of ['Own outcome', 'Shopping', 'Other', 'Top.']) expect(text, outside).not.toContain(outside);
    });

    it('stops at the deepest heading Markdown has; the "Sub-project of" line keeps the nesting unambiguous', () => {
      const chain = Array.from({ length: 8 }, (_, i) => node(`project-${i + 1}`, i ? `project-${i}` : null, { title: `P${i + 1}` }));
      const text = outline('Tree', chain, ['project-1']);
      expect(text).toContain('\n###### Project: P5\n\nSub-project of: P1 › P2 › P3 › P4\n');
      expect(text).toContain('\n###### Project: P8\n\nSub-project of: P1 › P2 › P3 › P4 › P5 › P6 › P7\n');
      expect(text).not.toContain('#######');
    });

    it('escapes project titles in the "Sub-project of" line too', () => {
      const nodes = [node('project-1', null, { title: '*Bold* <b>app</b>' }), node('project-2', 'project-1', { title: 'Inner' })];
      expect(outline('Tree', nodes, ['project-1'])).toContain('Sub-project of: \\*Bold\\* \\<b\\>app\\</b\\>\n');
    });

    it('writes the deepest chain of projects a tree can hold', () => {
      const chain = Array.from({ length: MAX_DEPTH }, (_, i) =>
        node(`project-${i + 1}`, i ? `project-${i}` : null, { title: `P${i + 1}` }),
      );
      const text = outline('Tree', chain, ['project-1']);
      expect(text.match(/^#{2,6} Project: /gm)).toHaveLength(MAX_DEPTH);
      expect(text).toContain(`###### Project: P${MAX_DEPTH}

Sub-project of: P1 › P2 › `);
    });
  });

  it('writes only the projects of the current view', () => {
    const text = outline('Tree', sampleNodes(), ['project-2']);
    expect(text).toContain('## Project: Title project-2');
    expect(text).not.toContain('project-1');
    expect(text).not.toContain('- **');
  });

  it('puts the links of a project under its notes, apart from them', () => {
    const nodes = [
      node('project-1', null, { note: 'Notes', links: [{ id: 1, name: 'Site', url: 'https://example.com' }] }),
      node('outcome-1', 'project-1'),
    ];
    expect(outline('Tree', nodes, ['project-1'])).toContain(
      ['> Notes', '', '- Links:', '  - [Site](https://example.com)', '- **Outcome:** Title outcome-1'].join('\n'),
    );
  });

  it('leaves out the evidence strength of a solution with no assumptions', () => {
    const nodes = [
      node('project-1', null),
      node('outcome-1', 'project-1'),
      node('opportunity-1', 'outcome-1', { status: 'parked' }),
      node('solution-1', 'opportunity-1', { status: 'candidate' }),
    ];
    expect(outline('Tree', nodes, ['project-1'])).toContain('- **Solution:** Title solution-1 — status: candidate\n');
  });

  it('keeps a title on one line and escapes what would be read as Markdown or HTML', () => {
    const nodes = [
      node('project-1', null, { title: '# Not a heading\n## still not' }),
      node('outcome-1', 'project-1', { title: '**bold** _em_ `code` [link](http://x) <script>alert(1)</script> ~~gone~~ &amp; \\' }),
    ];
    const text = outline('Doc *name*\n# second', nodes, ['project-1']);
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Doc \\*name\\* # second');
    expect(lines).toContain('## Project: # Not a heading ## still not');
    expect(lines).toContain(
      '- **Outcome:** \\*\\*bold\\*\\* \\_em\\_ \\`code\\` \\[link\\](http://x) \\<script\\>alert(1)\\</script\\> \\~\\~gone\\~\\~ \\&amp; \\\\',
    );
    // exactly the headings and bullets of the two nodes: nothing the user typed added structure
    expect(lines.filter(line => /^#{1,6} /.test(line))).toHaveLength(2);
    expect(lines.filter(line => /^\s*- /.test(line))).toHaveLength(1);
  });

  it('escapes open questions, owners and link names', () => {
    const nodes = [
      node('project-1', null),
      node('outcome-1', 'project-1'),
      node('opportunity-1', 'outcome-1', {
        status: 'exploring',
        questions: [{ id: 1, text: '[x] <b>done?</b>\n- injected', done: false }],
        links: [{ id: 1, name: 'a](http://evil) [b', url: 'https://example.com/a b' }],
      }),
      node('solution-1', 'opportunity-1', { status: 'candidate' }),
      node('assumption-1', 'solution-1', { status: 'testing', owner: '*me*' }),
    ];
    const text = outline('Tree', nodes, ['project-1']);
    expect(text).toContain('      - [ ] \\[x\\] \\<b\\>done?\\</b\\> - injected\n');
    expect(text).toContain('owner: \\*me\\*');
    expect(text).toContain('- a\\](http://evil) \\[b: https://example.com/a b\n');
  });

  it('handles a very deep tree without overflowing the stack', () => {
    const nodes = [node('project-1', null), node('outcome-1', 'project-1')];
    for (let i = 1; i <= 6000; i++) nodes.push(node(`opportunity-${i}`, i === 1 ? 'outcome-1' : `opportunity-${i - 1}`));
    const text = outline('Deep', nodes, ['project-1']);
    expect(text.split('\n').filter(line => line.includes('**Opportunity:**'))).toHaveLength(6000);
  });
});

describe('noteLines', () => {
  it('quotes notes, keeping paragraphs and line breaks', () => {
    expect(noteLines('First line\nsecond line\n\n\nNew paragraph\n')).toEqual(['> First line  ', '> second line', '>', '> New paragraph']);
  });

  it('writes nothing for empty notes', () => {
    expect(noteLines('')).toEqual([]);
    expect(noteLines(' \n \r\n')).toEqual([]);
  });

  it('defuses lines that would start a block', () => {
    expect(noteLines('# heading\n- item\n+ item\n1. one\n2) two\n> quote\n    code\n===\n---\n| a | b |\n```js')).toEqual([
      '> \\# heading  ',
      '> \\- item  ',
      '> \\+ item  ',
      '> 1\\. one  ',
      '> 2\\) two  ',
      '> \\> quote  ',
      '> code  ',
      '> \\===  ',
      '> \\---  ',
      '> \\| a | b |  ',
      '> \\`\\`\\`js',
    ]);
  });

  it('handles Windows line endings and control characters', () => {
    expect(noteLines('one\r\ntwo\u0000\u0007')).toEqual(['> one  ', '> two']);
  });
});

describe('linkItem', () => {
  it('writes a safe link as a Markdown link', () => {
    expect(linkItem('Notes', 'https://example.com/a?b=1&c=2')).toBe('[Notes](https://example.com/a?b=1&c=2)');
    expect(linkItem('Mail', 'mailto:someone@example.com')).toBe('[Mail](mailto:someone@example.com)');
  });

  it('encodes characters that would end the link early', () => {
    expect(linkItem('Wiki', 'https://example.com/a_(b)<c>\\d')).toBe('[Wiki](https://example.com/a_%28b%29%3Cc%3E%5Cd)');
  });

  it('writes anything else as plain text, never as a link', () => {
    expect(linkItem('Run', 'javascript:alert(1)')).toBe('Run: javascript:alert(1)');
    expect(linkItem('Data', 'data:text/html,<script>')).toBe('Data: data:text/html,\\<script\\>');
    expect(linkItem('', 'ftp://example.com')).toBe('Link: ftp://example.com');
  });
});

describe('escapeInline', () => {
  it('leaves ordinary prose alone', () => {
    expect(escapeInline('Plans (weekly) cost $5 & take 10% longer: why? #1!')).toBe('Plans (weekly) cost $5 & take 10% longer: why? #1!');
  });
});
