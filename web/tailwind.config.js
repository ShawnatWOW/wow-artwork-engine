/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // True-to-sign aspect ratios for the dashboard preview frames (§M2).
      aspectRatio: {
        spectacular: '1692 / 468',
        'eon-face': '256 / 384',
        'eon-master': '768 / 384',
      },
    },
  },
  plugins: [],
};
