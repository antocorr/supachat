import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: Number(process.env.CLIENT_PORT ?? 49174),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.SERVER_ORIGIN ?? 'http://127.0.0.1:49173',
        changeOrigin: true
      },
      '/assets': {
        target: process.env.SERVER_ORIGIN ?? 'http://127.0.0.1:49173',
        changeOrigin: true
      },
      '/ws': {
        target: process.env.SERVER_ORIGIN ?? 'http://127.0.0.1:49173',
        changeOrigin: true,
        ws: true
      }
    }
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.CLIENT_PORT ?? 49174),
    strictPort: true
  }
});
