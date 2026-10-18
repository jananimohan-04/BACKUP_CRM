import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

// https://vitejs.dev/config/
function retailSyncPlugin() {
  return {
    name: 'retail-sync-middleware',
    configureServer(server: any) {
      server.middlewares.use('/api/retail-sync', async (req: any, res: any, next: any) => {
        try {
          const modPath = nodeRequire.resolve('./server/retailSyncHandler.cjs');
          delete nodeRequire.cache[modPath];
          const { handleRetailSyncRequest } = nodeRequire('./server/retailSyncHandler.cjs');
          req.url = '/api/retail-sync' + (req.url.startsWith('/') ? req.url : '/' + req.url);
          await handleRetailSyncRequest(req, res);
        } catch (e) {
          next(e);
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  // The retail sync handler reads its settings (RETAIL_STORE_API_KEY ...) from process.env; make .env.local reach it in dev.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) if (process.env[k] === undefined) process.env[k] = v;
  return {
  plugins: [react(), retailSyncPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
};
});
