import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` is a build-time guard that keeps backend modules out of
      // client bundles. It has no runtime outside Next's bundler, so tests stub
      // it out — keeping the guard in the source rather than dropping the
      // import just to make a module testable.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts")
    }
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"]
  }
});
