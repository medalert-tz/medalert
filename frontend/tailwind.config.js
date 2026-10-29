/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          500: '#0284c7',
          600: '#0369a1',
          700: '#075985',
          900: '#0c4a6e',
        },
        watch: {
          bg: '#0f172a',
          card: '#1e293b',
          accent: '#38bdf8',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-subtle': 'bounceSubtle 2s infinite',
        'glow-pulse': 'glowPulse 2s infinite',
        'spin-slow': 'spin 8s linear infinite',
      },
      keyframes: {
        bounceSubtle: {
          '0%, 100%': { transform: 'translateY(-2%)' },
          '50%': { transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 15px rgba(56, 189, 248, 0.5)' },
          '50%': { opacity: '0.7', boxShadow: '0 0 5px rgba(56, 189, 248, 0.2)' },
        }
      }
    },
  },
  plugins: [],
}
