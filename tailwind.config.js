// Tailwind build config. Regenerate styles.css after changing classes:  npm run build:css
module.exports = {
  content: ['./index.html', './localdb.js', './nutrition.js'],
  theme: {
    extend: {
      colors: {
        granite: '#3F4B3B',
        deepmoss: '#2A3327',
        sand: '#A49966',
        drysage: '#C7C7A6',
        frostedmint: '#EAFFDA',
        darkraspberry: '#861657',
      },
    },
  },
};
