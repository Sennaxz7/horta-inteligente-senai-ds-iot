import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = {
    '/api/v1': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: true },
  };
  return {
    esbuild: { jsx: 'automatic' },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', proxy },
  };
});
