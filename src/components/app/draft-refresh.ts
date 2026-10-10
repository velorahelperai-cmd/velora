import { useState } from "react";
export type DraftFieldRefresh<T> = { values: T; baseline: T; conflicts: Array<keyof T> };
/** Preserve edits; newer server values replace only fields untouched since baseline. */
export function reconcileDraftFields<T extends { [K in keyof T]: string }>(values: T, baseline: T, server: T, previousConflicts: Array<keyof T> = []): DraftFieldRefresh<T> {
  const merged = { ...values }, conflicts: Array<keyof T> = [];
  for (const key of Object.keys(server) as Array<keyof T>) {
    if (values[key] === baseline[key]) merged[key] = server[key];
    else if (values[key] !== server[key] && (server[key] !== baseline[key] || previousConflicts.includes(key))) conflicts.push(key);
  }
  return { values: merged, baseline: { ...server }, conflicts };
}
/** Hours/language are local input state but obey the same three-way refresh. */
export function useServerDraftField<T extends string>(server: T) {
  const [state, setState] = useState({ value: server, baseline: server, conflict: false });
  if (state.baseline !== server) {
    const refresh = reconcileDraftFields({ value: state.value }, { value: state.baseline }, { value: server }, state.conflict ? ["value"] : []);
    setState({ value: refresh.values.value, baseline: server, conflict: refresh.conflicts.length > 0 });
  }
  return {
    value: state.value, dirty: state.value !== state.baseline, conflict: state.conflict,
    setValue: (value: T) => setState(prev => ({ ...prev, value, conflict: prev.conflict && value !== prev.baseline })),
    adopt: (value: T) => setState({ value, baseline: value, conflict: false }),
    resolve: () => setState(prev => ({ value: prev.baseline, baseline: prev.baseline, conflict: false })),
  };
}
