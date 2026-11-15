import { afterEach, describe, expect, it } from 'vitest';

import { enableAutoUnmount, flushPromises } from '@vue/test-utils';

import { dto } from '../../domain/fixtures.test-util';
import { RuleError } from '../../ost-errors';
import DetailPanel from '../DetailPanel.vue';
import { LINK_URL_RULE } from '../panel-format';
import { mountWith, setupStores } from '../panel.test-util';

import LinksTab from './LinksTab.vue';

enableAutoUnmount(afterEach);

async function mountTab(nodeKey: string) {
  const ctx = await setupStores();
  ctx.ui.select(nodeKey);
  const wrapper = await mountWith(LinksTab, ctx.pinia, { nodeKey });
  return { ...ctx, wrapper };
}

/** The tab inside the panel, which owns the inline error slot. */
async function mountInPanel(nodeKey: string) {
  const ctx = await setupStores();
  ctx.ui.select(nodeKey);
  ctx.ui.setPanelTab('links');
  const wrapper = await mountWith(DetailPanel, ctx.pinia);
  return { ...ctx, wrapper };
}

/** A tree whose only node carries the given link URL, as a file could. */
async function mountWithStoredUrl(url: string) {
  const ctx = await setupStores([dto('project-1', null, { links: [{ id: 5, name: 'From a file', url }] })]);
  const wrapper = await mountWith(LinksTab, ctx.pinia, { nodeKey: 'project-1' });
  return { ...ctx, wrapper };
}

const value = (el: { element: Element }) => (el.element as HTMLInputElement).value;

describe('LinksTab', () => {
  it('says the URL rule in words', () => {
    expect(LINK_URL_RULE).toBe('Links must start with http://, https:// or mailto:.');
  });

  it('renders one row per link: name + URL inputs, an open link in a new tab, a remove button', async () => {
    const { wrapper } = await mountTab('opportunity-1');
    const row = wrapper.get('[data-cy="ost-link-row-11"]');
    expect(value(row.get('[data-cy="ost-link-name"]'))).toBe('Research notes');
    expect(value(row.get('[data-cy="ost-link-url"]'))).toBe('https://example.com/research');
    const open = row.get('[data-cy="ost-link-open"]');
    expect(open.attributes('href')).toBe('https://example.com/research');
    expect(open.attributes('target')).toBe('_blank');
    expect(open.attributes('rel')).toBe('noopener noreferrer');
    expect(open.attributes('aria-label')).toBe('Open Research notes in a new tab');
    expect(row.get('[data-cy="ost-link-remove"]').attributes('aria-label')).toBe('Remove Research notes');
    expect(wrapper.find('[data-cy="ost-link-row-12"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-cy^="ost-link-row-"]')).toHaveLength(2);
    expect(wrapper.find('[data-cy="ost-links-empty"]').exists()).toBe(false);
  });

  it('a node without links says so and offers only "+ Add link"', async () => {
    const { wrapper } = await mountTab('outcome-1');
    expect(wrapper.get('[data-cy="ost-links-empty"]').text()).toBe('No links yet.');
    expect(wrapper.findAll('[data-cy^="ost-link-row-"]')).toHaveLength(0);
    expect(wrapper.findAll('button').map(b => b.text())).toEqual(['+ Add link']);
  });

  it('renders nothing for a node that is not in the tree', async () => {
    const ctx = await setupStores();
    const wrapper = await mountWith(LinksTab, ctx.pinia, { nodeKey: 'solution-99' });
    expect(wrapper.find('[data-cy="ostTab-links"]').exists()).toBe(false);
  });

  describe('which stored URLs can be opened', () => {
    it.each(['https://example.com/a', 'http://example.com/a', 'HTTPS://EXAMPLE.COM/a', 'mailto:someone@example.com'])(
      '%s is a clickable link',
      async url => {
        const { wrapper } = await mountWithStoredUrl(url);
        expect(wrapper.get('[data-cy="ost-link-open"]').attributes('href')).toBe(url);
      },
    );

    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/file',
      '//example.com/a',
      'example.com/a',
      'https://',
    ])('%s is shown as text only, never put in an href', async url => {
      const { wrapper } = await mountWithStoredUrl(url);
      const row = wrapper.get('[data-cy="ost-link-row-5"]');
      expect(row.find('[data-cy="ost-link-open"]').exists()).toBe(false);
      expect(wrapper.findAll('a')).toHaveLength(0);
      expect(wrapper.findAll('[href]')).toHaveLength(0);
      expect(wrapper.html()).not.toContain('href=');
      // the row is still there to be fixed or removed
      expect(value(row.get('[data-cy="ost-link-url"]'))).toBe(url);
      expect(row.find('[data-cy="ost-link-remove"]').exists()).toBe(true);
    });

    it('a link becomes clickable once its URL is corrected', async () => {
      const { wrapper, service } = await mountWithStoredUrl('javascript:alert(1)');
      service.updateLink.resolves({ id: 5, name: 'From a file', url: 'https://example.com/safe' });
      const url = wrapper.get('[data-cy="ost-link-url"]');
      await url.setValue('https://example.com/safe');
      await url.trigger('blur');
      await flushPromises();
      expect(service.updateLink.calledOnceWithExactly(5, { url: 'https://example.com/safe' })).toBe(true);
      expect(wrapper.get('[data-cy="ost-link-open"]').attributes('href')).toBe('https://example.com/safe');
    });
  });

  describe('add link', () => {
    it('opens an empty form with the name focused and the URL started', async () => {
      const { wrapper } = await mountTab('opportunity-1');
      expect(wrapper.find('[data-cy="ost-link-form"]').exists()).toBe(false);
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-link-add"]').exists()).toBe(false);
      expect(value(wrapper.get('[data-cy="ost-link-new-name"]'))).toBe('');
      expect(value(wrapper.get('[data-cy="ost-link-new-url"]'))).toBe('https://');
      expect(wrapper.get('[data-cy="ost-link-new-name"]').attributes('maxlength')).toBe('100');
      expect(wrapper.get('[data-cy="ost-link-new-url"]').attributes('maxlength')).toBe('2000');
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-link-new-name');
    });

    it('validates the name and the URL before calling the document service', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Spec');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('ftp://nope');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      expect(wrapper.get('[data-cy="ost-link-error"]').text()).toBe(LINK_URL_RULE);
      expect(wrapper.get('[data-cy="ost-link-error"]').attributes('role')).toBe('alert');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('https://');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      expect(wrapper.get('[data-cy="ost-link-error"]').text()).toBe(LINK_URL_RULE);
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('javascript:alert(1)');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      expect(wrapper.get('[data-cy="ost-link-error"]').text()).toBe(LINK_URL_RULE);
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('  ');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('https://example.com/spec');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      expect(wrapper.get('[data-cy="ost-link-error"]').text()).toBe('Give the link a name.');
      await flushPromises();
      expect(service.addLink.called).toBe(false);
      expect(wrapper.find('[data-cy="ost-link-form"]').exists()).toBe(true);
    });

    it('adds a valid link, closes the form and hands focus back to "+ Add link"', async () => {
      const { wrapper, service, tree } = await mountTab('outcome-1');
      service.addLink.resolves({ id: 21, name: 'Spec', url: 'https://example.com/spec' });
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue(' Spec ');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue(' https://example.com/spec ');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      await flushPromises();
      expect(service.addLink.calledOnceWithExactly('outcome', 1, { name: 'Spec', url: 'https://example.com/spec' })).toBe(true);
      expect(tree.byId('outcome-1')?.links).toEqual([{ id: 21, name: 'Spec', url: 'https://example.com/spec' }]);
      expect(wrapper.find('[data-cy="ost-link-form"]').exists()).toBe(false);
      expect(wrapper.find('[data-cy="ost-link-row-21"]').exists()).toBe(true);
      expect(wrapper.find('[data-cy="ost-links-empty"]').exists()).toBe(false);
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-link-add');
    });

    it('accepts a mailto: address', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      service.addLink.resolves({ id: 22, name: 'Research lead', url: 'mailto:lead@example.com' });
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Research lead');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('mailto:lead@example.com');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-link-error"]').exists()).toBe(false);
      expect(service.addLink.calledOnceWithExactly('outcome', 1, { name: 'Research lead', url: 'mailto:lead@example.com' })).toBe(true);
      expect(wrapper.get('[data-cy="ost-link-row-22"] [data-cy="ost-link-open"]').attributes('href')).toBe('mailto:lead@example.com');
    });

    it('accepts a plain http:// address', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      service.addLink.resolves({ id: 23, name: 'Intranet', url: 'http://intranet.example/page' });
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Intranet');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('http://intranet.example/page');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      await flushPromises();
      expect(service.addLink.calledOnceWithExactly('outcome', 1, { name: 'Intranet', url: 'http://intranet.example/page' })).toBe(true);
    });

    it('adds one link per submit: a second submit while the first is running is ignored', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      let resolve!: (link: { id: number; name: string; url: string }) => void;
      service.addLink.returns(new Promise(r => (resolve = r)));
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Spec');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('https://example.com/spec');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      expect(wrapper.get('[data-cy="ost-link-new-save"]').attributes('disabled')).toBeDefined();
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      expect(service.addLink.callCount).toBe(1);
      resolve({ id: 21, name: 'Spec', url: 'https://example.com/spec' });
      await flushPromises();
      expect(wrapper.findAll('[data-cy^="ost-link-row-"]')).toHaveLength(1);
    });

    it('Escape closes the form without saving, from either field', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Half-typed');
      await wrapper.get('[data-cy="ost-link-new-name"]').trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('[data-cy="ost-link-form"]').exists()).toBe(false);
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      expect(value(wrapper.get('[data-cy="ost-link-new-name"]'))).toBe(''); // a reopened form starts clean
      await wrapper.get('[data-cy="ost-link-new-url"]').trigger('keydown', { key: 'Escape' });
      expect(wrapper.find('[data-cy="ost-link-form"]').exists()).toBe(false);
      expect(service.addLink.called).toBe(false);
    });

    it('Cancel closes the form, forgets its error and returns focus to "+ Add link"', async () => {
      const { wrapper, service } = await mountTab('outcome-1');
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      expect(wrapper.find('[data-cy="ost-link-error"]').exists()).toBe(true);
      await wrapper.get('[data-cy="ost-link-new-cancel"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-link-form"]').exists()).toBe(false);
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-link-add');
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      expect(wrapper.find('[data-cy="ost-link-error"]').exists()).toBe(false);
      expect(service.addLink.called).toBe(false);
    });

    it('Escape in the add-link form returns focus to "+ Add link"', async () => {
      const { wrapper } = await mountTab('opportunity-1');
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await flushPromises();
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-link-new-name');
      await wrapper.get('[data-cy="ost-link-new-name"]').trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(document.activeElement?.getAttribute('data-cy')).toBe('ost-link-add');
    });

    it('a refused add is explained in the panel and keeps the form open with what was typed', async () => {
      const { wrapper, service, tree } = await mountInPanel('outcome-1');
      service.addLink.rejects(new RuleError('linkurlinvalid'));
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Spec');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('https://example.com/x');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Links must start with http://, https:// or mailto:.');
      expect(tree.error).toBeNull();
      expect(tree.byId('outcome-1')?.links).toEqual([]);
      expect(value(wrapper.get('[data-cy="ost-link-new-name"]'))).toBe('Spec');
      expect(value(wrapper.get('[data-cy="ost-link-new-url"]'))).toBe('https://example.com/x');
      expect(wrapper.get('[data-cy="ost-link-new-save"]').attributes('disabled')).toBeUndefined();
    });

    it('an add that fails for no known rule says the link could not be added', async () => {
      const { wrapper, service } = await mountInPanel('outcome-1');
      service.addLink.rejects(new Error('boom'));
      await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
      await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Spec');
      await wrapper.get('[data-cy="ost-link-new-url"]').setValue('https://example.com/x');
      await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The link could not be added.');
    });
  });

  describe('edit', () => {
    it('commits a renamed link on blur, trimmed', async () => {
      const { wrapper, service, tree } = await mountTab('opportunity-1');
      service.updateLink.resolves({ id: 12, name: 'Delivery plan', url: 'https://example.com/board/DISC-000' });
      const name = wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-name"]');
      await name.setValue('  Delivery plan ');
      await name.trigger('blur');
      await flushPromises();
      expect(service.updateLink.calledOnceWithExactly(12, { name: 'Delivery plan' })).toBe(true);
      expect(tree.byId('opportunity-1')?.links[1].name).toBe('Delivery plan');
      expect(value(name)).toBe('Delivery plan');
    });

    it('commits a renamed link on Enter', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      service.updateLink.resolves({ id: 12, name: 'Delivery plan', url: 'https://example.com/board/DISC-000' });
      const name = wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-name"]');
      (name.element as HTMLInputElement).focus();
      await name.setValue('Delivery plan');
      await name.trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(service.updateLink.calledOnceWithExactly(12, { name: 'Delivery plan' })).toBe(true);
      expect(document.activeElement).not.toBe(name.element);
    });

    it('an emptied name is refused inline and snaps back', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      const row = wrapper.get('[data-cy="ost-link-row-12"]');
      const name = row.get('[data-cy="ost-link-name"]');
      await name.setValue('   ');
      await name.trigger('blur');
      expect(row.get('[data-cy="ost-link-error"]').text()).toBe('Link names cannot be empty.');
      expect(value(name)).toBe('Delivery board');
      expect(service.updateLink.called).toBe(false);
      // the message goes away with the next edit that is fine
      service.updateLink.resolves({ id: 12, name: 'Delivery plan', url: 'https://example.com/board/DISC-000' });
      await name.setValue('Delivery plan');
      await name.trigger('blur');
      await flushPromises();
      expect(row.find('[data-cy="ost-link-error"]').exists()).toBe(false);
    });

    it('rejects an invalid URL edit inline and keeps the stored URL', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      const row = wrapper.get('[data-cy="ost-link-row-12"]');
      const url = row.get('[data-cy="ost-link-url"]');
      for (const bad of ['not a url', 'javascript:alert(1)', 'ftp://example.com/x', '']) {
        await url.setValue(bad);
        await url.trigger('blur');
        expect(row.get('[data-cy="ost-link-error"]').text()).toBe(LINK_URL_RULE);
        expect(value(url)).toBe('https://example.com/board/DISC-000');
      }
      expect(row.get('[data-cy="ost-link-open"]').attributes('href')).toBe('https://example.com/board/DISC-000');
      // only the row that was edited complains
      expect(wrapper.find('[data-cy="ost-link-row-11"] [data-cy="ost-link-error"]').exists()).toBe(false);
      await flushPromises();
      expect(service.updateLink.called).toBe(false);
    });

    it('commits a valid URL edit', async () => {
      const { wrapper, service, tree } = await mountTab('opportunity-1');
      service.updateLink.resolves({ id: 12, name: 'Delivery board', url: 'https://example.com/board/DISC-42' });
      const url = wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-url"]');
      await url.setValue(' https://example.com/board/DISC-42 ');
      await url.trigger('blur');
      await flushPromises();
      expect(service.updateLink.calledOnceWithExactly(12, { url: 'https://example.com/board/DISC-42' })).toBe(true);
      expect(tree.byId('opportunity-1')?.links[1].url).toBe('https://example.com/board/DISC-42');
      expect(wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-open"]').attributes('href')).toBe(
        'https://example.com/board/DISC-42',
      );
    });

    it('a URL can be changed to a mailto: address', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      service.updateLink.resolves({ id: 12, name: 'Delivery board', url: 'mailto:board@example.com' });
      const row = wrapper.get('[data-cy="ost-link-row-12"]');
      const url = row.get('[data-cy="ost-link-url"]');
      await url.setValue('mailto:board@example.com');
      await url.trigger('blur');
      await flushPromises();
      expect(row.find('[data-cy="ost-link-error"]').exists()).toBe(false);
      expect(service.updateLink.calledOnceWithExactly(12, { url: 'mailto:board@example.com' })).toBe(true);
      expect(row.get('[data-cy="ost-link-open"]').attributes('href')).toBe('mailto:board@example.com');
    });

    it('leaving a field unchanged sends nothing', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      const row = wrapper.get('[data-cy="ost-link-row-12"]');
      await row.get('[data-cy="ost-link-name"]').setValue(' Delivery board ');
      await row.get('[data-cy="ost-link-name"]').trigger('blur');
      await row.get('[data-cy="ost-link-url"]').trigger('blur');
      await flushPromises();
      expect(service.updateLink.called).toBe(false);
      expect(value(row.get('[data-cy="ost-link-name"]'))).toBe('Delivery board');
      expect(row.find('[data-cy="ost-link-error"]').exists()).toBe(false);
    });

    it('Escape reverts the row, clears its error and saves nothing', async () => {
      const { wrapper, service } = await mountTab('opportunity-1');
      const row = wrapper.get('[data-cy="ost-link-row-12"]');
      const name = row.get('[data-cy="ost-link-name"]');
      const url = row.get('[data-cy="ost-link-url"]');
      await url.setValue('nope');
      await url.trigger('blur');
      expect(row.find('[data-cy="ost-link-error"]').exists()).toBe(true);
      (name.element as HTMLInputElement).focus();
      await name.setValue('Something else');
      await name.trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(value(name)).toBe('Delivery board');
      expect(row.find('[data-cy="ost-link-error"]').exists()).toBe(false);
      expect(document.activeElement).not.toBe(name.element);
      (url.element as HTMLInputElement).focus();
      await url.setValue('https://example.com/other');
      await url.trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(value(url)).toBe('https://example.com/board/DISC-000');
      expect(service.updateLink.called).toBe(false);
    });

    it('a refused edit rolls back in the tree and in the field', async () => {
      const { wrapper, service, tree } = await mountTab('opportunity-1');
      service.updateLink.rejects(new RuleError('linknameinvalid'));
      const name = wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-name"]');
      await name.setValue('Delivery plan');
      await name.trigger('blur');
      await flushPromises();
      expect(service.updateLink.calledOnceWithExactly(12, { name: 'Delivery plan' })).toBe(true);
      expect(tree.byId('opportunity-1')?.links[1].name).toBe('Delivery board');
      expect(value(name)).toBe('Delivery board');
      // LinksTab alone has no panel to show it in — the message is still taken off the toast
      expect(tree.error).toBeNull();
    });

    it('a refused edit is explained in the panel', async () => {
      const { wrapper, service } = await mountInPanel('opportunity-1');
      service.updateLink.rejects(new RuleError('linknameinvalid'));
      const name = wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-name"]');
      await name.setValue('Delivery plan');
      await name.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('Link names need 1 to 100 characters.');
      service.updateLink.rejects(new Error('boom'));
      await name.setValue('Delivery plan');
      await name.trigger('blur');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The link could not be saved.');
    });

    it('a stored name change resets the name draft only, never the URL being typed', async () => {
      const { wrapper, tree } = await mountTab('opportunity-1');
      const row = wrapper.get('[data-cy="ost-link-row-11"]');
      const url = row.get('[data-cy="ost-link-url"]');
      (url.element as HTMLInputElement).focus();
      await url.setValue('https://typing.example/in-progress');
      tree.byId('opportunity-1')!.links[0].name = 'Renamed elsewhere';
      await flushPromises();
      expect(value(row.get('[data-cy="ost-link-name"]'))).toBe('Renamed elsewhere');
      expect(value(url)).toBe('https://typing.example/in-progress');
    });

    it('a stored URL change does not overwrite a focused URL draft, but does once it is not focused', async () => {
      const { wrapper, tree } = await mountTab('opportunity-1');
      const row = wrapper.get('[data-cy="ost-link-row-11"]');
      const url = row.get('[data-cy="ost-link-url"]');
      (url.element as HTMLInputElement).focus();
      await url.setValue('https://typing.example/');
      tree.byId('opportunity-1')!.links[0].url = 'https://stored.example/a';
      await flushPromises();
      expect(value(url)).toBe('https://typing.example/');
      await url.setValue('https://stored.example/a'); // nothing to save on blur
      (url.element as HTMLInputElement).blur();
      tree.byId('opportunity-1')!.links[0].url = 'https://stored.example/b';
      await flushPromises();
      expect(value(url)).toBe('https://stored.example/b');
    });
  });

  describe('remove', () => {
    it('removes a link once the document service accepted', async () => {
      const { wrapper, service, tree } = await mountTab('opportunity-1');
      let resolve!: () => void;
      service.deleteLink.returns(new Promise<void>(r => (resolve = r)));
      await wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-remove"]').trigger('click');
      await flushPromises();
      expect(service.deleteLink.calledOnceWithExactly(12)).toBe(true);
      expect(wrapper.find('[data-cy="ost-link-row-12"]').exists()).toBe(true); // not before
      resolve();
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-link-row-12"]').exists()).toBe(false);
      expect(wrapper.find('[data-cy="ost-link-row-11"]').exists()).toBe(true);
      expect(tree.byId('opportunity-1')?.links.map(l => l.id)).toEqual([11]);
    });

    it('removing the last link brings the empty note back', async () => {
      const { wrapper, service } = await mountTab('project-1');
      service.deleteLink.resolves();
      await wrapper.get('[data-cy="ost-link-row-1"] [data-cy="ost-link-remove"]').trigger('click');
      await flushPromises();
      expect(wrapper.findAll('[data-cy^="ost-link-row-"]')).toHaveLength(0);
      expect(wrapper.get('[data-cy="ost-links-empty"]').text()).toBe('No links yet.');
    });

    it('a refused remove keeps the link and is explained in the panel', async () => {
      const { wrapper, service, tree } = await mountInPanel('opportunity-1');
      service.deleteLink.rejects(new Error('boom'));
      await wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-remove"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-cy="ost-link-row-12"]').exists()).toBe(true);
      expect(tree.byId('opportunity-1')?.links.map(l => l.id)).toEqual([11, 12]);
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('The link could not be removed.');
      expect(wrapper.get('[data-cy="ost-tab-badge-links"]').text()).toBe('2');
      service.deleteLink.rejects(new RuleError('linkmissing'));
      await wrapper.get('[data-cy="ost-link-row-12"] [data-cy="ost-link-remove"]').trigger('click');
      await flushPromises();
      expect(wrapper.get('[data-cy="ost-panel-error"]').text()).toBe('That link no longer exists.');
    });
  });

  it('the Links tab badge counts the links as they are added and removed', async () => {
    const { wrapper, service } = await mountInPanel('opportunity-1');
    expect(wrapper.get('[data-cy="ost-tab-badge-links"]').text()).toBe('2');
    service.addLink.resolves({ id: 13, name: 'Spec', url: 'https://example.com/spec' });
    await wrapper.get('[data-cy="ost-link-add"]').trigger('click');
    await wrapper.get('[data-cy="ost-link-new-name"]').setValue('Spec');
    await wrapper.get('[data-cy="ost-link-new-url"]').setValue('https://example.com/spec');
    await wrapper.get('[data-cy="ost-link-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[data-cy="ost-tab-badge-links"]').text()).toBe('3');
    service.deleteLink.resolves();
    for (const id of [11, 12, 13]) {
      await wrapper.get(`[data-cy="ost-link-row-${id}"] [data-cy="ost-link-remove"]`).trigger('click');
      await flushPromises();
    }
    expect(wrapper.find('[data-cy="ost-tab-badge-links"]').exists()).toBe(false);
  });
});
