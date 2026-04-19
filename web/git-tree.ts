import type { Entity } from '../src/types';

export interface GitTreeNode {
  children: GitTreeNode[];
  entity: Entity | null;
  name: string;
  path: string;
  type: 'file' | 'directory';
}

function compareNodes(left: GitTreeNode, right: GitTreeNode): number {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

export function buildGitTree(entities: Entity[]): GitTreeNode | null {
  const structureEntities = entities.filter(
    (entity) => entity.type === 'file' || entity.type === 'directory',
  );

  if (structureEntities.length === 0) {
    return null;
  }

  const nodes = new Map<string, GitTreeNode>();

  for (const entity of structureEntities) {
    const entityPath = entity.path ?? entity.name ?? entity.id;
    const nodeType: GitTreeNode['type'] = entity.type === 'directory' ? 'directory' : 'file';
    nodes.set(entityPath, {
      children: [],
      entity,
      name: entity.name ?? entityPath,
      path: entityPath,
      type: nodeType,
    });
  }

  const root = nodes.get('.') ?? {
    children: [],
    entity: null,
    name: 'repository',
    path: '.',
    type: 'directory',
  };

  for (const node of nodes.values()) {
    if (node.path === '.') {
      continue;
    }

    const segments = node.path.split('/');
    const parentPath =
      segments.length === 1 ? '.' : segments.slice(0, segments.length - 1).join('/');
    const parentNode = nodes.get(parentPath) ?? root;
    parentNode.children.push(node);
  }

  const sortTree = (node: GitTreeNode): void => {
    node.children.sort(compareNodes);
    for (const child of node.children) {
      sortTree(child);
    }
  };

  sortTree(root);
  return root;
}

export function buildActivePathSet(activePath: string | null): Set<string> {
  const paths = new Set<string>();
  if (!activePath) {
    return paths;
  }

  paths.add('.');
  if (activePath === '.') {
    return paths;
  }

  const segments = activePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    paths.add(segments.slice(0, index + 1).join('/'));
  }

  return paths;
}
