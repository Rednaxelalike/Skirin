import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Two entry points: the editor and the per-monitor selection overlay. Tauri
// serves the built folder as the app root, so `overlay.html` has to survive
// the build as its own document rather than being inlined.
export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react(), tailwindcss()],

  // Tauri drives the dev server; a moving port would break `devUrl`.
  server: { port: 5173, strictPort: true },
  // Vite would otherwise hide Rust's compiler output behind its own overlay.
  clearScreen: false,

  build: {
    outDir: resolve('src/renderer/dist'),
    emptyOutDir: true,
    // WebView2 is evergreen Chromium, so there is no reason to ship
    // transpiled-down output the runtime does not need.
    target: 'chrome110',
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve('src/renderer/index.html'),
        overlay: resolve('src/renderer/overlay.html')
      }
    }
  }
})
