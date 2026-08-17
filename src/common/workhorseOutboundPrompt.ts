/**
 * Strip Workhorse AI outbound envelopes so UI / history sync keep only the
 * user-visible request text.
 */
export function normalizeWorkhorseVisibleUserText(text: string): string {
  const currentRequestMarker = '[Current user request]';
  const currentRequestIndex = text.lastIndexOf(currentRequestMarker);
  if (currentRequestIndex >= 0) {
    const visible = text.slice(currentRequestIndex + currentRequestMarker.length).trim();
    if (visible) return visible;
  }

  const taskMarker = '[Subagent Task]';
  const taskIndex = text.lastIndexOf(taskMarker);
  if (taskIndex >= 0) {
    const taskStart = taskIndex + taskMarker.length;
    const taskTail = text.slice(taskStart);
    const beginMatch = /\n\s*Begin\. Execute the assigned task to completion\./.exec(taskTail);
    const visible = (beginMatch ? taskTail.slice(0, beginMatch.index) : taskTail).trim();
    if (visible) return visible;
  }

  return text;
}

/** True when text looks like a Workhorse AI system-instruction envelope. */
export function looksLikeWorkhorseSystemEnvelope(text: string): boolean {
  return text.includes('[Workhorse AI system instructions]')
    || text.includes('[System instructions]')
    || text.includes('[Current user request]')
    || text.includes('[Subagent Task]');
}
