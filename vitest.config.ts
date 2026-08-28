import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@releaselens/core": `${root}packages/core/src/index.ts`,
      "@releaselens/platform": `${root}packages/platform/src/index.ts`,
    },
  },
  test: {
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    reporters: ["default"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true,
  },
});
