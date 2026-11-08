import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 100,
    ignorePatterns: ["CHANGELOG.md"],
  },
  lint: {
    ignorePatterns: ["**/dist/**"],
    plugins: ["typescript", "unicorn", "import"],
    env: { node: true },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        files: ["**/*.test.ts"],
        plugins: ["vitest"],
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
