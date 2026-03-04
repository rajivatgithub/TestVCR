import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'


export default defineConfig({
  plugins: [react()],
  server: {
    host: true,             // Listen on all local IPs so ngrok can see it
    allowedHosts: 'all',    // Bypasses host header checks for ngrok
  }
})
