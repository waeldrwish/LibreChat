import { UNLIMITED_USAGE } from 'librechat-data-provider';
import { fromLimitDraft, toLimitDraft } from '../access/LimitsSection';

describe('usage limit drafts', () => {
  it('round-trips inherit, unlimited and explicit values', () => {
    const limits = { tokensPerDay: 5000, messagesPerMonth: UNLIMITED_USAGE, messagesPerDay: 0 };
    const draft = toLimitDraft(limits);
    expect(draft.tokensPerDay).toEqual({ mode: 'custom', value: '5000' });
    expect(draft.tokensPerMonth).toEqual({ mode: 'inherit', value: '' });
    expect(draft.messagesPerMonth).toEqual({ mode: 'unlimited', value: '' });
    expect(draft.messagesPerDay).toEqual({ mode: 'custom', value: '0' });
    expect(fromLimitDraft(draft)).toEqual(limits);
  });

  it('rejects a custom value that is empty, negative or fractional', () => {
    const draft = toLimitDraft({});
    expect(fromLimitDraft({ ...draft, tokensPerDay: { mode: 'custom', value: '' } })).toBeNull();
    expect(fromLimitDraft({ ...draft, tokensPerDay: { mode: 'custom', value: '-1' } })).toBeNull();
    expect(fromLimitDraft({ ...draft, tokensPerDay: { mode: 'custom', value: '1.5' } })).toBeNull();
    expect(fromLimitDraft(draft)).toEqual({});
  });
});
