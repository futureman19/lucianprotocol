import 'dotenv/config';

import { extractGraph } from './graphify-bridge';
import { createRepositoryOverlay, saveRepositoryOverlay, syncRepositoryEntitiesToSupabase } from './git-parser';

async function main(): Promise<void> {
  const repositoryPath = process.argv[2];

  if (!repositoryPath) {
    throw new Error('Usage: npm run import-git -- <path-to-repository>');
  }

  const overlay = await createRepositoryOverlay(repositoryPath);
  await saveRepositoryOverlay(overlay);

  void (async () => {
    const graph = await extractGraph(overlay.repoRoot, overlay.repoName, overlay.headSha);
    if (graph) {
      console.log(
        `[graphify] repo=${graph.repoName} head=${graph.headSha.slice(0, 8)} nodes=${graph.graph.nodes.length} edges=${graph.graph.edges.length}`,
      );
    }
  })();

  await syncRepositoryEntitiesToSupabase(overlay.entities);

  const fileCount = overlay.entities.filter((entity) => entity.type === 'file').length;
  const directoryCount = overlay.entities.filter((entity) => entity.type === 'directory').length;

  console.log(
    `[import-git] repo=${overlay.repoName} head=${overlay.headSha.slice(0, 8)} files=${fileCount} directories=${directoryCount} overlay=.lux-state/repository-overlay.json`,
  );
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : (
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
        )
        ? error.message
        : 'Unknown import-git failure';
  console.error(`[import-git] ${message}`);
  process.exit(1);
});
