import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 8080,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 4096,
  }
});
