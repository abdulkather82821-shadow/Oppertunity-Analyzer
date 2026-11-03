import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dbe6fe', 200: '#bfd3fe', 300: '#93b4fd',
          400: '#608afa', 500: '#3b63f6', 600: '#2542eb', 700: '#1d32d8',
          800: '#1e2caf', 900: '#1e2b8a', 950: '#171d54',
        },
        ink: { 50: '#f6f7f9', 100: '#eceef2', 200: '#d5d9e2', 300: '#b0b8c9',
               400: '#8591ab', 500: '#667390', 600: '#515c77', 700: '#434b61',
               800: '#3a4152', 900: '#343947', 950: '#22252f' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)' },
    },
  },
  plugins: [],
};
export default config;
