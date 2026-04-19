import type { Entity, EntityType } from './types';

const LIGHTWEIGHT_EXTENSIONS = new Set(['.json', '.md', '.yml', '.yaml', '.toml']);
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.mp3',
  '.mp4',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);

export function getExtension(filePath: string): string | null {
  const lastSlash = filePath.lastIndexOf('/');
  const basename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const lastDot = basename.lastIndexOf('.');
  const extension = lastDot >= 0 ? basename.slice(lastDot).toLowerCase() : '';
  return extension.length > 0 ? extension : null;
}

export function isBinaryExtension(extension: string | null): boolean {
  return extension !== null && BINARY_EXTENSIONS.has(extension);
}

export function mapMassToPath(filePath: string, entityType: EntityType): number {
  if (entityType === 'directory') {
    return 5;
  }

  if (entityType !== 'file') {
    return 1;
  }

  const extension = getExtension(filePath);

  if (isBinaryExtension(extension)) {
    return 10;
  }

  if (extension !== null && LIGHTWEIGHT_EXTENSIONS.has(extension)) {
    return 1;
  }

  if (extension !== null && JAVASCRIPT_EXTENSIONS.has(extension)) {
    return 2;
  }

  if (extension !== null && TYPESCRIPT_EXTENSIONS.has(extension)) {
    return 3;
  }

  return 2;
}

export function describeStructureNode(filePath: string, entityType: EntityType): string {
  if (entityType === 'directory') {
    return 'Directory cluster';
  }

  const extension = getExtension(filePath);
  const lastSlash = filePath.lastIndexOf('/');
  const filename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

  if (extension === '.tsx' || extension === '.jsx') {
    return /^[A-Z]/.test(filename)
      ? 'React component'
      : 'React source file';
  }

  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
    return 'TypeScript module';
  }

  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return 'JavaScript module';
  }

  if (extension === '.json') {
    return 'JSON config';
  }

  if (extension === '.md') {
    return 'Markdown document';
  }

  if (isBinaryExtension(extension)) {
    return 'Binary asset';
  }

  return 'Source artifact';
}

export function isStructureEntity(entity: Entity): boolean {
  return entity.type === 'file' || entity.type === 'directory';
}
