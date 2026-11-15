import { describe, expect, it } from 'vitest';

import { RuleError, describeError } from './ost-errors';

describe('OST error messages', () => {
  it('turns a refused write into the sentence of its rule', () => {
    expect(describeError(new RuleError('cycle'))).toBe('A node cannot move under its own descendant.');
    expect(describeError(new RuleError('unknowntype'))).toBe('That node type is not recognised.');
    expect(describeError(new RuleError('invalidparent'))).toBe('That node cannot go there.');
    expect(describeError(new RuleError('linkurlinvalid'))).toBe('Links must start with http://, https:// or mailto:.');
    expect(describeError(new RuleError('nodocument'))).toBe('No tree is open.');
  });

  it('a RuleError carries its key and reads as its sentence', () => {
    const err = new RuleError('questiontextinvalid');
    expect(err).toBeInstanceOf(Error);
    expect(err.key).toBe('questiontextinvalid');
    expect(err.message).toBe('Questions need 1 to 500 characters.');
  });

  it('states the title rule of the node type when one is given', () => {
    const invalid = new RuleError('invalidtitle');
    expect(describeError(invalid, undefined, 'project')).toBe('Project names need 2 to 100 characters.');
    expect(describeError(invalid, undefined, 'opportunity')).toBe('Titles need 2 to 200 characters.');
    expect(describeError(invalid, undefined, 'evidence')).toBe('Titles need 2 to 500 characters.');
    // Without a type the general rule is stated.
    expect(describeError(invalid)).toBe('Titles need 2 to 200 characters (100 for projects, 500 for assumptions and evidence).');
  });

  it('falls back to the given sentence for anything that is not a rule', () => {
    expect(describeError(new Error('boom'))).toBe('Something went wrong. Your change was not saved.');
    expect(describeError(new Error('boom'), 'Could not save.')).toBe('Could not save.');
    expect(describeError(undefined, 'Could not save.')).toBe('Could not save.');
    // Whatever an unexpected error says is never shown to the user.
    expect(describeError(new TypeError('x is not a function'), 'Could not save.')).not.toContain('function');
  });
});
