// Test stub for the `server-only` package.
//
// In a Next build, importing `server-only` makes the bundler fail if the module
// is ever pulled into a client bundle. That guard has no runtime behaviour, and
// the real package has no Node entry point, so vitest cannot resolve it.
// Aliasing to this empty module (see vitest.config.ts) lets server modules keep
// the import — and keep the guard in production — while staying testable.
export {};
