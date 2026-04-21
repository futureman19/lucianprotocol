export interface DiffLine {
  type: 'context' | 'removed' | 'added';
  text: string;
}

function computeLcsMatrix(a: string[], b: string[]): number[][] {
  const m: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        m[i]![j] = m[i - 1]![j - 1]! + 1;
      } else {
        m[i]![j] = Math.max(m[i - 1]![j]!, m[i]![j - 1]!);
      }
    }
  }

  return m;
}

function backtrackLcs(m: number[][], a: string[], b: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'context', text: a[i - 1]! });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || m[i]![j - 1]! >= m[i - 1]![j]!)) {
      result.unshift({ type: 'added', text: b[j - 1]! });
      j -= 1;
    } else if (i > 0) {
      result.unshift({ type: 'removed', text: a[i - 1]! });
      i -= 1;
    }
  }

  return result;
}

export function computeLineDiff(original: string, modified: string): DiffLine[] {
  const oldLines = original.split('\n');
  const newLines = modified.split('\n');

  if (oldLines.length === 0 && newLines.length === 0) {
    return [];
  }

  if (oldLines.length === 0) {
    return newLines.map((text: string) => ({ type: 'added' as const, text }));
  }

  if (newLines.length === 0) {
    return oldLines.map((text: string) => ({ type: 'removed' as const, text }));
  }

  const matrix = computeLcsMatrix(oldLines, newLines);
  return backtrackLcs(matrix, oldLines, newLines);
}

export function renderUnifiedDiff(lines: DiffLine[]): string {
  return lines.map((line) => {
    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
    return `${prefix}${line.text}`;
  }).join('\n');
}
