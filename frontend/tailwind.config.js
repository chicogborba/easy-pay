/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#fdfbf7',
        pencil: '#2d2d2d',
        muted: '#e5e0d8',
        marker: '#ff4d4d',
        pen: '#2d5da1',
        postit: '#fff9c4',
        leaf: '#2f8f4e',
      },
      fontFamily: {
        heading: ['Kalam', 'cursive'],
        body: ['"Patrick Hand"', 'cursive'],
      },
      borderRadius: {
        wobbly: '255px 15px 225px 15px / 15px 225px 15px 255px',
        wobblyMd: '15px 225px 15px 255px / 255px 15px 225px 15px',
        wobblySm: '12px 30px 14px 28px / 28px 14px 30px 12px',
        blob: '60% 40% 55% 45% / 45% 55% 40% 60%',
      },
      boxShadow: {
        hard: '4px 4px 0px 0px #2d2d2d',
        hardSm: '2px 2px 0px 0px #2d2d2d',
        hardLg: '8px 8px 0px 0px #2d2d2d',
        soft: '3px 3px 0px 0px rgba(45,45,45,0.1)',
      },
      keyframes: {
        bob: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        pop: { '0%': { transform: 'scale(.9) rotate(-2deg)', opacity: 0 }, '100%': { transform: 'scale(1) rotate(0)', opacity: 1 } },
        stamp: { '0%': { transform: 'scale(2.2) rotate(-18deg)', opacity: 0 }, '100%': { transform: 'scale(1) rotate(-12deg)', opacity: 1 } },
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(255,77,77,.5)' }, '100%': { boxShadow: '0 0 0 18px rgba(255,77,77,0)' } },
      },
      animation: {
        bob: 'bob 3s ease-in-out infinite',
        pop: 'pop .18s ease-out',
        stamp: 'stamp .35s cubic-bezier(.2,1.6,.4,1) forwards',
        pulseRing: 'pulseRing 1.1s ease-out infinite',
      },
    },
  },
  plugins: [],
}
