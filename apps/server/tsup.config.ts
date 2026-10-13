import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts', 'lambda/guardian': 'src/lambda/guardian.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // Workspace packages ship TypeScript sources, so they are compiled into the bundle.
  noExternal: [/^@finorchestrate\//],
});
