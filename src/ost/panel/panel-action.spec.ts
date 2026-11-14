import { describe, expect, it } from 'vitest';

import { RuleError } from '../ost-errors';

import { usePanelAction } from './panel-action';
import { setupStores } from './panel.test-util';

describe('usePanelAction', () => {
  it('returns the result of an action that worked and reports nothing', async () => {
    const ctx = await setupStores();
    ctx.ui.select('opportunity-1');
    const { run, errors } = usePanelAction();

    expect(await run(async () => true)).toBe(true);
    expect(await run(async () => 'solution-9')).toBe('solution-9');

    expect(errors.message.value).toBeNull();
    expect(errors.nodeKey.value).toBeNull();
    expect(ctx.tree.error).toBeNull();
  });

  it('reports the message the store recorded for THIS action', async () => {
    const ctx = await setupStores();
    ctx.ui.select('opportunity-1');
    const { run, errors } = usePanelAction();

    const ok = await run(async () => {
      ctx.tree.error = 'The link could not be saved.';
      return false;
    });

    expect(ok).toBe(false);
    expect(errors.message.value).toBe('The link could not be saved.');
    expect(errors.nodeKey.value).toBe('opportunity-1');
    expect(ctx.tree.error).toBeNull(); // moved off the toast, into the panel
  });

  it('a failure without a recorded reason gets the fallback: the default one, or the action’s own', async () => {
    const ctx = await setupStores();
    ctx.ui.select('opportunity-1');
    const { run, errors } = usePanelAction();

    await run(async () => false);
    expect(errors.message.value).toBe('Something went wrong. Your change was not saved.');

    // A create that fails resolves to null rather than false.
    expect(await run(async () => null, 'The node could not be created.')).toBeNull();
    expect(errors.message.value).toBe('The node could not be created.');
    expect(errors.nodeKey.value).toBe('opportunity-1');
  });

  it('starting another action clears the previous message', async () => {
    const ctx = await setupStores();
    ctx.ui.select('opportunity-1');
    const { run, errors } = usePanelAction();

    await run(async () => false);
    expect(errors.message.value).not.toBeNull();
    await run(async () => true);

    expect(errors.message.value).toBeNull();
    expect(errors.nodeKey.value).toBeNull();
  });

  it('never attributes an error left over from something else to the action that just failed', async () => {
    // Several store actions return false without recording a reason (a link or question that is
    // already gone, a patch of a node that is not there). `run` used to read whatever was sitting
    // in the store's `error` and show THAT next to the field the user was editing — and clear it
    // off the toast, so the real message vanished too.
    const ctx = await setupStores();
    ctx.ui.select('opportunity-1');
    ctx.tree.error = 'The node could not be moved.';
    const { run, errors } = usePanelAction();

    await run(async () => false, 'The link could not be saved.');

    expect(errors.message.value).toBe('The link could not be saved.');
    expect(ctx.tree.error).toBe('The node could not be moved.'); // still on the toast, untouched
  });

  it('leaves a reasonless failure alone on the toast when the user has moved on', async () => {
    const ctx = await setupStores();
    ctx.ui.select('opportunity-1');
    ctx.tree.error = 'The node could not be moved.';
    const { run, errors } = usePanelAction();

    await run(async () => {
      ctx.ui.select('solution-1');
      return false;
    });

    expect(errors.message.value).toBeNull();
    expect(ctx.tree.error).toBe('The node could not be moved.');
  });

  it('labels a failure that lands after the selection moved with the node it was about', async () => {
    const ctx = await setupStores();
    ctx.ui.select('opportunity-1');
    const { run, errors } = usePanelAction();

    await run(async () => {
      ctx.ui.select('solution-1');
      ctx.tree.error = 'That status is not valid for this node.';
      return false;
    });

    expect(errors.message.value).toBeNull();
    expect(ctx.tree.error).toBe('“Hard to find people”: That status is not valid for this node.');
  });

  describe('with the tree store’s own actions', () => {
    it('a write the document service refuses shows the rule it broke', async () => {
      const ctx = await setupStores();
      ctx.ui.select('opportunity-1');
      ctx.service.updateLink.rejects(new RuleError('linknameinvalid'));
      const { run, errors } = usePanelAction();

      const ok = await run(() => ctx.tree.updateLink('opportunity-1', 11, { name: 'x'.repeat(101) }));

      expect(ok).toBe(false);
      expect(errors.message.value).toBe('Link names need 1 to 100 characters.');
      expect(errors.nodeKey.value).toBe('opportunity-1');
      expect(ctx.tree.error).toBeNull();
      expect(ctx.tree.byId('opportunity-1')?.links[0].name).toBe('Research notes'); // rolled back
    });

    it('any other failure shows what the store action says could not be done', async () => {
      const ctx = await setupStores();
      ctx.ui.select('opportunity-1');
      ctx.service.updateLink.rejects(new Error('boom'));
      const { run, errors } = usePanelAction();

      await run(() => ctx.tree.updateLink('opportunity-1', 11, { name: 'Renamed' }));

      expect(errors.message.value).toBe('The link could not be saved.');
      expect(ctx.tree.error).toBeNull();
    });

    it('a field patch that fails for no known rule gets the generic message', async () => {
      const ctx = await setupStores();
      ctx.ui.select('opportunity-1');
      ctx.service.patchNode.rejects(new Error('boom'));
      const { run, errors } = usePanelAction();

      await run(() => ctx.tree.patchNode('opportunity-1', { priority: 70 }));

      expect(errors.message.value).toBe('Something went wrong. Your change was not saved.');
      expect(ctx.tree.byId('opportunity-1')?.priority).toBe(50);
    });

    it('an action that bails out without touching the service uses the caller’s fallback', async () => {
      const ctx = await setupStores();
      ctx.ui.select('opportunity-1');
      const { run, errors } = usePanelAction();

      // link 99 does not exist: the store returns false and records nothing
      await run(() => ctx.tree.removeLink('opportunity-1', 99), 'The link could not be removed.');

      expect(ctx.service.deleteLink.called).toBe(false);
      expect(errors.message.value).toBe('The link could not be removed.');
    });
  });
});
