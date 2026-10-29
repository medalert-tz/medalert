import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: `npm run dev` on :3000 forwards /api calls to the FastAPI server on :8000.
// Production: `npm run build`, then FastAPI serves frontend/dist at http://localhost:8000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
});
