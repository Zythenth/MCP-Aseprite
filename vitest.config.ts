import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/e2e/**/*.test.ts",
    ],
    testTimeout: 15000,
    hookTimeout: 10000,
  },
});
