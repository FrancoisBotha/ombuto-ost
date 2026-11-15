import { describe, expect, it } from 'vitest';

import { dto, node } from './fixtures.test-util';
import { fromDto, nodeKey, parseKey, toApiType, toNodeType, toPatchBody } from './mapping';

describe('OST mapping', () => {
  it('maps a TreeNodeDTO onto the lower-case domain vocabulary, key as id, parentKey as parent', () => {
    const mapped = fromDto(
      dto('opportunity-12', 'outcome-3', {
        status: 'EXPLORING',
        notes: 'why',
        priority: 70,
        valueRating: 4,
        sortOrder: 5,
        links: [{ id: 1, name: 'Research notes', url: 'https://x.test/a' }],
        questions: [{ id: 2, text: 'Who?', done: false }],
      }),
    );
    expect(mapped).toMatchObject({
      id: 'opportunity-12',
      dbId: 12,
      type: 'opportunity',
      parent: 'outcome-3',
      note: 'why',
      status: 'exploring',
      priority: 70,
      value: 4,
      sortOrder: 5,
      links: [{ id: 1, name: 'Research notes', url: 'https://x.test/a' }],
      questions: [{ id: 2, text: 'Who?', done: false }],
    });
  });

  it('defaults null fields to empty domain values', () => {
    const mapped = fromDto(
      dto('project-1', null, { status: null, notes: null, owner: null, links: null, questions: null, sortOrder: null }),
    );
    expect(mapped).toMatchObject({
      parent: null,
      status: '',
      note: '',
      owner: '',
      links: [],
      questions: [],
      sortOrder: 0,
    });
  });

  it('carries the free-text owner of an assumption', () => {
    expect(fromDto(dto('assumption-4', 'solution-1', { owner: 'Research' })).owner).toBe('Research');
  });

  it('builds a PATCH body with only the changed fields, upper-casing status and clearing empties', () => {
    expect(toPatchBody({ status: 'validated', value: 5 })).toEqual({ status: 'VALIDATED', valueRating: 5 });
    expect(toPatchBody({ note: '', owner: '' })).toEqual({ notes: null, owner: null });
    expect(toPatchBody({ title: 'T', conf: 55, priority: 20, owner: 'user', note: 'n' })).toEqual({
      title: 'T',
      confidence: 55,
      priority: 20,
      owner: 'user',
      notes: 'n',
    });
  });

  it('parses and builds node keys', () => {
    expect(parseKey('assumption-44')).toEqual({ type: 'assumption', id: 44 });
    expect(parseKey('widget-1')).toBeNull();
    expect(parseKey('opportunity')).toBeNull();
    expect(nodeKey('evidence', 3)).toBe('evidence-3');
  });

  it('converts types both ways', () => {
    expect(toApiType('solution')).toBe('SOLUTION');
    expect(toNodeType('EVIDENCE')).toBe('evidence');
    expect(() => toNodeType('BET')).toThrow();
  });
});
