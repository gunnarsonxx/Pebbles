import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __PEBBLES_BUILD__: JSON.stringify(process.env.GITHUB_RUN_NUMBER ?? '0'),
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'desktop/**/*.test.ts'],
  },
} as any);
