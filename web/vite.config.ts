import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'deployment-development-files',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === '/imd-deployment.json' || /^\/abi\/[\w]+\.json$/.test(path || '')) {
          try {
            const bytes = await readFile(resolve(import.meta.dirname, '../dist', `.${path}`));
            res.setHeader('Content-Type', 'application/json'); res.end(bytes);
          } catch { next(); }
        } else next();
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});
