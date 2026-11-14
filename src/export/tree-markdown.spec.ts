import { describe, expect, it } from 'vitest';

import { node, sampleNodes } from '@/ost/domain/fixtures.test-util';

import { escapeInline, linkItem, noteLines, treeToMarkdown } from './tree-markdown';

const outline = (...args: Parameters<typeof treeToMarkdown>): string => {
  const result = treeToMarkdown(...args);
  if (result === null) throw new Error('nothing written');
  return result;
};

describe('treeToMarkdown', () => {
  it('returns null when there is no product to write', () => {
    expect(treeToMarkdown('Tree', [], [])).toBeNull();
    expect(treeToMarkdown('Tree', sampleNodes(), [])).toBeNull();
    expect(treeToMarkdown('Tree', sampleNodes(), ['product-404'])).toBeNull();
  });

  it('writes the whole outline: a heading per product and a nested bullet per node', () => {
    const nodes = [
      node('product-1', null, { title: 'Meal planner', note: 'The product.' }),
      node('outcome-1', 'product-1', { title: 'More weekly plans' }),
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
      node('product-2', null, { title: 'Second product' }),
    ];
    expect(outline('My tree', nodes, ['product-1', 'product-2'])).toBe(
      [
        '# My tree',
        '',
        'An Opportunity Solution Tree: product → outcome → opportunity → solution → assumption → evidence.',
        'Each bullet is one node and the bullets nested under it are its children; quoted text is the notes of the node.',
        '',
        '## Product: Meal planner',
        '',
        '> The product.',
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
        '## Product: Second product',
        '',
      ].join('\n'),
    );
  });

  it('writes only the products of the current view', () => {
    const text = outline('Tree', sampleNodes(), ['product-2']);
    expect(text).toContain('## Product: Title product-2');
    expect(text).not.toContain('product-1');
    expect(text).not.toContain('- **');
  });

  it('puts the links of a product under its notes, apart from them', () => {
    const nodes = [
      node('product-1', null, { note: 'Notes', links: [{ id: 1, name: 'Site', url: 'https://example.com' }] }),
      node('outcome-1', 'product-1'),
    ];
    expect(outline('Tree', nodes, ['product-1'])).toContain(
      ['> Notes', '', '- Links:', '  - [Site](https://example.com)', '- **Outcome:** Title outcome-1'].join('\n'),
    );
  });

  it('leaves out the evidence strength of a solution with no assumptions', () => {
    const nodes = [
      node('product-1', null),
      node('outcome-1', 'product-1'),
      node('opportunity-1', 'outcome-1', { status: 'parked' }),
      node('solution-1', 'opportunity-1', { status: 'candidate' }),
    ];
    expect(outline('Tree', nodes, ['product-1'])).toContain('- **Solution:** Title solution-1 — status: candidate\n');
  });

  it('keeps a title on one line and escapes what would be read as Markdown or HTML', () => {
    const nodes = [
      node('product-1', null, { title: '# Not a heading\n## still not' }),
      node('outcome-1', 'product-1', { title: '**bold** _em_ `code` [link](http://x) <script>alert(1)</script> ~~gone~~ &amp; \\' }),
    ];
    const text = outline('Doc *name*\n# second', nodes, ['product-1']);
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Doc \\*name\\* # second');
    expect(lines).toContain('## Product: # Not a heading ## still not');
    expect(lines).toContain(
      '- **Outcome:** \\*\\*bold\\*\\* \\_em\\_ \\`code\\` \\[link\\](http://x) \\<script\\>alert(1)\\</script\\> \\~\\~gone\\~\\~ \\&amp; \\\\',
    );
    // exactly the headings and bullets of the two nodes: nothing the user typed added structure
    expect(lines.filter(line => /^#{1,6} /.test(line))).toHaveLength(2);
    expect(lines.filter(line => /^\s*- /.test(line))).toHaveLength(1);
  });

  it('escapes open questions, owners and link names', () => {
    const nodes = [
      node('product-1', null),
      node('outcome-1', 'product-1'),
      node('opportunity-1', 'outcome-1', {
        status: 'exploring',
        questions: [{ id: 1, text: '[x] <b>done?</b>\n- injected', done: false }],
        links: [{ id: 1, name: 'a](http://evil) [b', url: 'https://example.com/a b' }],
      }),
      node('solution-1', 'opportunity-1', { status: 'candidate' }),
      node('assumption-1', 'solution-1', { status: 'testing', owner: '*me*' }),
    ];
    const text = outline('Tree', nodes, ['product-1']);
    expect(text).toContain('      - [ ] \\[x\\] \\<b\\>done?\\</b\\> - injected\n');
    expect(text).toContain('owner: \\*me\\*');
    expect(text).toContain('- a\\](http://evil) \\[b: https://example.com/a b\n');
  });

  it('handles a very deep tree without overflowing the stack', () => {
    const nodes = [node('product-1', null), node('outcome-1', 'product-1')];
    for (let i = 1; i <= 6000; i++) nodes.push(node(`opportunity-${i}`, i === 1 ? 'outcome-1' : `opportunity-${i - 1}`));
    const text = outline('Deep', nodes, ['product-1']);
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
