import { describe, expect, it } from 'vitest';

import { escapeXml, estimateTextWidth, textWidth, wrapText } from './text';

/** Every character is 10 wide: makes the expected wrapping easy to read. */
const mono = (text: string) => [...text].length * 10;

describe('escapeXml', () => {
  it('turns markup characters into entities', () => {
    expect(escapeXml(`</text><script>alert("x")</script> & 'y'`)).toBe(
      '&lt;/text&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
  });

  it('drops characters XML 1.0 forbids, and keeps tabs, newlines and astral characters', () => {
    expect(escapeXml('a\u0000b\u0008c\u000bd\u001fe￾f')).toBe('abcdef');
    expect(escapeXml('a\tb\nc')).toBe('a\tb\nc');
    expect(escapeXml('ok 😀')).toBe('ok 😀');
    expect(escapeXml('lone \ud800 surrogate')).toBe('lone  surrogate');
  });
});

describe('estimateTextWidth', () => {
  it('grows with the text, the size and the weight', () => {
    const regular = estimateTextWidth('Opportunity', { size: 10, weight: 400 });
    expect(regular).toBeGreaterThan(0);
    expect(estimateTextWidth('Opportunity tree', { size: 10, weight: 400 })).toBeGreaterThan(regular);
    expect(estimateTextWidth('Opportunity', { size: 20, weight: 400 })).toBeCloseTo(regular * 2);
    expect(estimateTextWidth('Opportunity', { size: 10, weight: 600 })).toBeGreaterThan(regular);
  });

  it('counts narrow letters as narrower and full-width glyphs as wider', () => {
    const font = { size: 10, weight: 400 };
    expect(estimateTextWidth('iiii', font)).toBeLessThan(estimateTextWidth('nnnn', font));
    expect(estimateTextWidth('漢字', font)).toBeGreaterThan(estimateTextWidth('nn', font));
  });

  it('adds letter spacing per character', () => {
    expect(textWidth('abcd', { size: 10, weight: 400, letterSpacing: 1 }, mono)).toBe(44);
  });
});

describe('wrapText', () => {
  it('keeps short text on one line and collapses whitespace', () => {
    expect(wrapText('  two \n words ', 200, 3, mono)).toEqual(['two words']);
  });

  it('returns no lines for blank text', () => {
    expect(wrapText('   ', 100, 3, mono)).toEqual([]);
  });

  it('breaks between words', () => {
    expect(wrapText('aaaa bbbb cccc dddd', 90, 3, mono)).toEqual(['aaaa bbbb', 'cccc dddd']);
  });

  it('breaks a word that is longer than a line', () => {
    expect(wrapText('abcdefghijklmno', 50, 4, mono)).toEqual(['abcde', 'fghij', 'klmno']);
    expect(wrapText('ab abcdefgh', 50, 4, mono)).toEqual(['ab', 'abcde', 'fgh']);
  });

  it('ends the last line with an ellipsis when the text does not fit', () => {
    const lines = wrapText('aaaa bbbb cccc dddd eeee ffff', 90, 2, mono);
    expect(lines).toEqual(['aaaa bbbb', 'cccc ddd…']);
    for (const line of lines) expect(mono(line)).toBeLessThanOrEqual(90);
  });

  it('truncates one endless word', () => {
    expect(wrapText('x'.repeat(500), 50, 2, mono)).toEqual(['xxxxx', 'xxxx…']);
  });

  it('never loops on a line narrower than one character', () => {
    expect(wrapText('abc', 1, 2, mono)).toEqual(['a', 'b…']);
  });
});
