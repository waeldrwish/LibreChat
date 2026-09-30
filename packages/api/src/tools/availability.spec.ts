import { isToolEnabled, setToolEnabled } from './availability';

describe('isToolEnabled', () => {
  it('enables every tool when neither list is set', () => {
    expect(isToolEnabled(undefined, 'dalle')).toBe(true);
    expect(isToolEnabled({ filteredTools: [], includedTools: [] }, 'dalle')).toBe(true);
  });

  it('switches off the tools in filteredTools', () => {
    expect(isToolEnabled({ filteredTools: ['dalle'] }, 'dalle')).toBe(false);
    expect(isToolEnabled({ filteredTools: ['dalle'] }, 'wolfram')).toBe(true);
  });

  it('lets includedTools win over filteredTools', () => {
    const lists = { includedTools: ['wolfram'], filteredTools: ['wolfram'] };
    expect(isToolEnabled(lists, 'wolfram')).toBe(true);
    expect(isToolEnabled(lists, 'dalle')).toBe(false);
  });
});

describe('setToolEnabled', () => {
  it('edits filteredTools when the config filters', () => {
    expect(setToolEnabled({ filteredTools: ['flux'] }, 'dalle', false)).toEqual({
      filteredTools: ['flux', 'dalle'],
    });
    expect(setToolEnabled({ filteredTools: ['flux', 'dalle'] }, 'dalle', true)).toEqual({
      filteredTools: ['flux'],
    });
  });

  it('edits includedTools when the config includes', () => {
    expect(setToolEnabled({ includedTools: ['flux'] }, 'dalle', true)).toEqual({
      includedTools: ['flux', 'dalle'],
    });
    expect(setToolEnabled({ includedTools: ['flux', 'dalle'] }, 'flux', false)).toEqual({
      includedTools: ['dalle'],
    });
  });

  it('does not list a tool twice', () => {
    expect(setToolEnabled({ filteredTools: ['dalle'] }, 'dalle', false)).toEqual({
      filteredTools: ['dalle'],
    });
  });
});
