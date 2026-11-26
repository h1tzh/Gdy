import { defineConfig } from 'vite';
import { DEFAULT_GAME_PORT } from './shared/protocol.js';

export default defineConfig({
  server: {
    proxy: { '/socket.io': { target: `http://127.0.0.1:${process.env.PORT ?? DEFAULT_GAME_PORT}`, ws: true } },
  },
  build: { outDir: 'dist/client' },
});
