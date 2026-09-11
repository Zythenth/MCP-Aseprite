import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
    ],
    testTimeout: 15000,
    hookTimeout: 10000,
    passWithNoTests: true,
  },
});