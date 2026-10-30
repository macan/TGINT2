import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [vue(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('cytoscape')) {
                return 'vendor-cytoscape';
              }
              if (id.includes('pako') || id.includes('lz4') || id.includes('@addmaple')) {
                return 'vendor-compression';
              }
              if (id.includes('markdown-it') || id.includes('dompurify')) {
                return 'vendor-markdown';
              }
              if (id.includes('lucide-vue-next') || id.includes('lucide-react')) {
                return 'vendor-icons';
              }
              if (id.includes('vue') || id.includes('@vue')) {
                return 'vendor-vue';
              }
              return 'vendor-libs';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
