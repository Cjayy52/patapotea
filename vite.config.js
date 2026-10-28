import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  return {
    root: 'client',
    base: './',
    plugins: [react(), ...(preview ? [viteSingleFile()] : [])],
    build: {
      outDir: preview ? '../preview-dist' : '../dist',
      emptyOutDir: true,
      target: 'es2020',
      rollupOptions: preview
        ? { output: { inlineDynamicImports: true, entryFileNames: 'app.js' } }
        : undefined,
    },
    define: {
      __PREVIEW_MODE__: JSON.stringify(preview),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: 'http://localhost:3001', changeOrigin: true },
      },
    },
  };
});
