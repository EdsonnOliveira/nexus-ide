import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  return {
    plugins: [react()],
    envDir: path.resolve(__dirname, '../..'),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@nexus/protocol': path.resolve(__dirname, '../../packages/protocol/src/index.ts'),
        '@nexus/supabase': path.resolve(__dirname, '../../packages/supabase/src/index.ts'),
        '@nexus/bridge': path.resolve(__dirname, '../../packages/bridge/src/index.ts'),
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(rootEnv.VITE_SUPABASE_URL ?? ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(rootEnv.VITE_SUPABASE_ANON_KEY ?? ''),
      'import.meta.env.VITE_VAPID_PUBLIC_KEY': JSON.stringify(rootEnv.VITE_VAPID_PUBLIC_KEY ?? ''),
    },
    server: {
      port: 5174,
      proxy: {
        '/vercel-api': {
          target: 'https://api.vercel.com',
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/vercel-api/, ''),
        },
      },
    },
  };
});
