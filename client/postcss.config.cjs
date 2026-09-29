module.exports = {
  plugins: [
    require('postcss-import'),
    /**
     * Logical properties (`ms-*`, `ps-*`, `start-*`, `text-start`) stay logical: the downgrade
     * rewrites them to their left-to-right physical form, which mirrors nothing when an RTL
     * locale sets `dir="rtl"` on the document.
     */
    require('postcss-preset-env')({ features: { 'logical-properties-and-values': false } }),
    require('tailwindcss'),
    require('autoprefixer'),
  ],
};
