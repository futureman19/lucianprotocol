export interface ImportEdge {
  source: string;
  resolvedPath: string | null;
  kind: 'import' | 'require';
}

const EXTENSION_CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

const IMPORT_PATTERN = /import\s+(?:(?:type\s+)?(?:\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?['"]([^'"]+)['"];?/g;
const REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_FROM_PATTERN = /export\s+(?:(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"];?/g;

export function parseImportsFromContent(content: string): Array<{ source: string; kind: 'import' | 'require' }> {
  const results: Array<{ source: string; kind: 'import' | 'require' }> = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const source = match[1];
    if (source && source.startsWith('.') && !seen.has(source)) {
      seen.add(source);
      results.push({ source, kind: 'import' });
    }
  }

  for (const match of content.matchAll(REQUIRE_PATTERN)) {
    const source = match[1];
    if (source && source.startsWith('.') && !seen.has(source)) {
      seen.add(source);
      results.push({ source, kind: 'require' });
    }
  }

  for (const match of content.matchAll(EXPORT_FROM_PATTERN)) {
    const source = match[1];
    if (source && source.startsWith('.') && !seen.has(source)) {
      seen.add(source);
      results.push({ source, kind: 'import' });
    }
  }

  return results;
}

export function resolveImportPath(
  source: string,
  fromFilePath: string,
  availablePaths: Set<string>,
): string | null {
  // Skip non-relative and bare specifiers
  if (!source.startsWith('.')) {
    return null;
  }

  const fromDir = fromFilePath.includes('/') ? fromFilePath.slice(0, fromFilePath.lastIndexOf('/')) : '';
  const normalizedSource = source.replace(/\/+/g, '/').replace(/\/$/, '');

  // Build the base path relative to repo root
  let basePath: string;
  if (fromDir.length === 0) {
    basePath = normalizedSource;
  } else {
    const segments = fromDir.split('/');
    const sourceSegments = normalizedSource.split('/');
    for (const segment of sourceSegments) {
      if (segment === '..') {
        segments.pop();
      } else if (segment !== '.') {
        segments.push(segment);
      }
    }
    basePath = segments.join('/');
  }

  for (const ext of EXTENSION_CANDIDATES) {
    const candidate = `${basePath}${ext}`;
    if (availablePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildTetherMap(
  fileNodes: Array<{ path: string; content: string | null; contentPreview?: string | null }>,
): Map<string, ImportEdge[]> {
  const availablePaths = new Set(fileNodes.map((n) => n.path));
  const tetherMap = new Map<string, ImportEdge[]>();
  const fromMap = new Map<string, string[]>();

  for (const node of fileNodes) {
    const sourceText = node.content ?? node.contentPreview ?? '';
    if (!sourceText) {
      continue;
    }

    const imports = parseImportsFromContent(sourceText);
    const edges: ImportEdge[] = [];

    for (const imp of imports) {
      const resolved = resolveImportPath(imp.source, node.path, availablePaths);
      edges.push({ source: imp.source, resolvedPath: resolved, kind: imp.kind });
      if (resolved) {
        const fromList = fromMap.get(resolved) ?? [];
        fromList.push(node.path);
        fromMap.set(resolved, fromList);
      }
    }

    if (edges.length > 0) {
      tetherMap.set(node.path, edges);
    }
  }

  // Attach reverse references as a second pass
  for (const [path, edges] of tetherMap.entries()) {
    for (const edge of edges) {
      if (edge.resolvedPath === null) {
        continue;
      }
      const reverseList = fromMap.get(edge.resolvedPath) ?? [];
      if (!reverseList.includes(path)) {
        reverseList.push(path);
        fromMap.set(edge.resolvedPath, reverseList);
      }
    }
  }

  return tetherMap;
}
