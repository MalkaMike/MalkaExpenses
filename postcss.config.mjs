// Named before export so the object is not an anonymous default, which the
// import plugin flags because an anonymous default is awkward to re-import.
const config = {
  plugins: { tailwindcss: {}, autoprefixer: {} }
};

export default config;
