import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En développement, /api est relayé vers le serveur Flask (python server.py, port 8000).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8000' } },
  build: { outDir: 'dist', emptyOutDir: true },
})
