/** Turns a refused tree write into a short sentence for the UI. */
import { TITLE_MIN, titleMax } from './canvas/edit-rules';
import type { NodeType } from './domain/types';

const MESSAGES = {
  unknowntype: 'That node type is not recognised.',
  parentmissing: 'The parent node no longer exists.',
  nodemissing: 'That node no longer exists.',
  invalidparent: 'That node cannot go there.',
  fieldnotapplicable: 'That field does not apply to this node.',
  invalidtitle: 'Titles need 2 to 200 characters (100 for products, 500 for assumptions and evidence).',
  invalidnotes: 'Notes can be at most 20,000 characters.',
  invalidstatus: 'That status is not valid for this node.',
  invalidconfidence: 'Confidence must be between 0 and 100.',
  invalidpriority: 'Priority must be between 1 and 100.',
  invalidvaluerating: 'Value must be between 1 and 5.',
  invalidowner: 'Owner names can be at most 100 characters.',
  invalidposition: 'That position is not valid.',
  cycle: 'A node cannot move under its own descendant.',
  linkmissing: 'That link no longer exists.',
  linknameinvalid: 'Link names need 1 to 100 characters.',
  linkurlinvalid: 'Links must start with http://, https:// or mailto:.',
  questionmissing: 'That question no longer exists.',
  questiontextinvalid: 'Questions need 1 to 500 characters.',
  nodocument: 'No tree is open.',
} as const;

export type RuleKey = keyof typeof MESSAGES;

/** A write the document service refused because it breaks one of the tree's rules. */
export class RuleError extends Error {
  readonly key: RuleKey;

  constructor(key: RuleKey) {
    super(MESSAGES[key]);
    this.name = 'RuleError';
    this.key = key;
  }
}

/**
 * `type` (the node the failed write was about) makes the title rule specific: products 100,
 * assumptions and evidence 500, the other types 200 characters.
 */
export function describeError(err: unknown, fallback = 'Something went wrong. Your change was not saved.', type?: NodeType): string {
  if (!(err instanceof RuleError)) return fallback;
  if (err.key === 'invalidtitle' && type)
    return `${type === 'product' ? 'Product names' : 'Titles'} need ${TITLE_MIN} to ${titleMax(type)} characters.`;
  return MESSAGES[err.key];
}
