import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_SERVER_PORT = Number.parseInt(process.env.DEV_SERVER_PORT ?? '3000', 10);

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    host: true,
    port: Number.parseInt(process.env.VITE_PORT ?? '5173', 10),
    proxy: {
      '/ws': { target: `ws://localhost:${DEV_SERVER_PORT}`, ws: true },
      '/api': { target: `http://localhost:${DEV_SERVER_PORT}` },
      '/healthz': { target: `http://localhost:${DEV_SERVER_PORT}` },
    },
  },
});
