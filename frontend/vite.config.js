import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@poptu-faculties': path.resolve(__dirname, '../backend/data/poptu-faculties.json'),
    },
  },
  server: {
    fs: { allow: ['.', '..'] },
  },
  build: {
    /** Smaller, faster JS on modern browsers (adjust if you must support very old Safari). */
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
