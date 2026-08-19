/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#2d3748',
        moss: '#1A73E8',
        mist: '#f5f7fa',
        sand: '#e8edf3'
      },
      boxShadow: {
        soft: '0 8px 28px rgba(59,108,183,.10)'
      }
    }
  },
  plugins: []
}
