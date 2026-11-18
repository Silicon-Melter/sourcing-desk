import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Built to dist/, then scripts/to-artifact.mjs folds it into one self-contained HTML page: publishable as a claude.ai artifact, and the same
// bundle can later be wrapped by Tauri for the desktop installer.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@app': resolve(__dirname, 'src/app') } },
  build: { outDir: 'dist', assetsInlineLimit: 100000000, cssCodeSplit: false, modulePreload: false }
})
