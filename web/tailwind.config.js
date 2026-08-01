/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Touch browsers keep :hover stuck on the last-tapped element, which made a
  // failed optimistic action look identical to a successful one (mobile audit
  // 2026-08-01). This scopes every hover: style to devices that really hover.
  future: { hoverOnlyWhenSupported: true },
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
