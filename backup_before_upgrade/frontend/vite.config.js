import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production'

  return {
    plugins: [react()],
    build: {
      sourcemap: false,
      reportCompressedSize: false,
      minify: 'esbuild',
      target: 'es2020',
    },
    esbuild: isProduction
      ? {
          drop: ['console', 'debugger'],
          legalComments: 'none',
        }
      : undefined,
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:4000'
      }
    }
  }
})
