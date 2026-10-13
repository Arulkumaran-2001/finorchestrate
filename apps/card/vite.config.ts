import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Builds the MCP App view into one self contained HTML file. The MCP server
 * serves it as the `ui://finorchestrate/card.html` resource.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [viteSingleFile()],
  build: {
    outDir: fileURLToPath(new URL('../server/views', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { input: fileURLToPath(new URL('./card.html', import.meta.url)) },
  },
});
