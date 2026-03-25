/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/index.html', './src/renderer/**/*.{ts,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif']
      }
    }
  },
  plugins: []
};
