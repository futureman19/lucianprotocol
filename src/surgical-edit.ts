export function applyPatch(content: string, oldText: string, newText: string): string {
  if (!content.includes(oldText)) {
    throw new Error('old_text not found in content');
  }
  return content.replace(oldText, newText);
}

export function applyInsert(content: string, afterLine: number, text: string): string {
  const lines = content.split('\n');
  if (afterLine <= 0) {
    return text + (content.length > 0 ? '\n' + content : '');
  }
  if (afterLine >= lines.length) {
    return content.length > 0 ? content + '\n' + text : text;
  }
  const before = lines.slice(0, afterLine).join('\n');
  const after = lines.slice(afterLine).join('\n');
  return before + '\n' + text + (after.length > 0 ? '\n' + after : '');
}

export function applyDelete(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  if (startLine > lines.length || startLine > endLine || startLine < 1) {
    throw new Error('invalid line range');
  }
  const clampedEnd = Math.min(endLine, lines.length);
  const before = lines.slice(0, startLine - 1).join('\n');
  const after = lines.slice(clampedEnd).join('\n');
  if (before.length === 0 && after.length === 0) {
    return '';
  }
  if (before.length === 0) {
    return after;
  }
  if (after.length === 0) {
    return before;
  }
  return before + '\n' + after;
}
