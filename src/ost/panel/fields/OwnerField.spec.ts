import { afterEach, describe, expect, it } from 'vitest';

import { enableAutoUnmount, mount } from '@vue/test-utils';

import OwnerField from './OwnerField.vue';

enableAutoUnmount(afterEach);

function mountField(value = '') {
  const wrapper = mount(OwnerField, { props: { value }, attachTo: document.body });
  const input = wrapper.get('[data-cy="ost-owner"]');
  return { wrapper, input, field: input.element as HTMLInputElement };
}

describe('OwnerField', () => {
  it('is a labelled free-text input showing the stored owner, capped at 100 characters', () => {
    const { wrapper, input, field } = mountField('Kira P');
    expect(field.tagName).toBe('INPUT');
    expect(field.value).toBe('Kira P');
    expect(input.attributes('maxlength')).toBe('100');
    const label = wrapper.get('label');
    expect(label.text()).toBe('Owner');
    expect(label.attributes('for')).toBe(input.attributes('id'));
  });

  it('commits the trimmed text on Enter, which leaves the field', async () => {
    const { wrapper, input, field } = mountField();
    field.focus();
    await input.setValue('  Ana R ');
    expect(wrapper.emitted('change')).toBeUndefined(); // nothing while typing
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('change')).toEqual([['Ana R']]);
    expect(field.value).toBe('Ana R');
    expect(document.activeElement).not.toBe(field);
  });

  it('commits the trimmed text on blur', async () => {
    const { wrapper, input, field } = mountField('Kira P');
    await input.trigger('focus');
    await input.setValue(' Research group  ');
    await input.trigger('blur');
    expect(wrapper.emitted('change')).toEqual([['Research group']]);
    expect(field.value).toBe('Research group');
  });

  it('clearing the field commits an empty owner', async () => {
    const { wrapper, input } = mountField('Kira P');
    await input.trigger('focus');
    await input.setValue('   ');
    await input.trigger('blur');
    expect(wrapper.emitted('change')).toEqual([['']]);
  });

  it('emits nothing when the text is unchanged (surrounding spaces do not count)', async () => {
    const { wrapper, input, field } = mountField('Kira P');
    await input.trigger('focus');
    await input.trigger('blur');
    await input.trigger('focus');
    await input.setValue('  Kira P ');
    await input.trigger('blur');
    expect(wrapper.emitted('change')).toBeUndefined();
    expect(field.value).toBe('Kira P');
  });

  it('Escape reverts to the stored owner and keeps focus; leaving afterwards commits nothing', async () => {
    const { wrapper, input, field } = mountField('Kira P');
    field.focus();
    await input.setValue('Someone else');
    await input.trigger('keydown', { key: 'Escape' });
    expect(field.value).toBe('Kira P');
    expect(document.activeElement).toBe(field);
    await input.trigger('blur');
    expect(wrapper.emitted('change')).toBeUndefined();
  });

  it('follows the stored owner while it is not being edited', async () => {
    const { wrapper, field } = mountField('Kira P');
    await wrapper.setProps({ value: 'Ana R' });
    expect(field.value).toBe('Ana R');
    await wrapper.setProps({ value: '' });
    expect(field.value).toBe('');
  });

  it('keeps what is being typed when the stored owner changes, and follows it again after leaving', async () => {
    const { wrapper, input, field } = mountField('Kira P');
    await input.trigger('focus');
    await input.setValue('Typing a na');
    await wrapper.setProps({ value: 'Ana R' });
    expect(field.value).toBe('Typing a na');
    await input.trigger('blur');
    expect(wrapper.emitted('change')).toEqual([['Typing a na']]);
    await wrapper.setProps({ value: 'Typing a na' });
    await wrapper.setProps({ value: 'Changed later' });
    expect(field.value).toBe('Changed later');
  });
});
