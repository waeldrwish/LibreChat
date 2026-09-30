/** The two `librechat.yaml` switches that decide which tools exist. */
export type ToolLists = {
  filteredTools?: string[];
  includedTools?: string[];
};

/**
 * `includedTools` wins: when it lists anything, only those tools are on;
 * otherwise every tool is on except those in `filteredTools`.
 */
export function isToolEnabled(lists: ToolLists | null | undefined, key: string): boolean {
  const included = lists?.includedTools ?? [];
  if (included.length > 0) {
    return included.includes(key);
  }
  return !(lists?.filteredTools ?? []).includes(key);
}

/**
 * The one list to write so `key` ends up `enabled`, edited in whichever mode
 * the config already uses so the other list keeps its meaning.
 */
export function setToolEnabled(
  lists: ToolLists | null | undefined,
  key: string,
  enabled: boolean,
): ToolLists {
  const included = lists?.includedTools ?? [];
  if (included.length > 0) {
    const rest = included.filter((item) => item !== key);
    return { includedTools: enabled ? [...rest, key] : rest };
  }
  const rest = (lists?.filteredTools ?? []).filter((item) => item !== key);
  return { filteredTools: enabled ? rest : [...rest, key] };
}
