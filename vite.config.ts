import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    printWidth: 100,
    ignorePatterns: ["CHANGELOG.md"],
  },
  lint: {
    // Los tests de las plantillas son de `bun test` y se copian a la app, cuyo
    // tsconfig los deja fuera (la app no tiene por qué tener @types/bun). Acá
    // los corre la CI con `bun test templates`, no los revisa el lint.
    ignorePatterns: ["**/dist/**", "templates/**/*.test.ts"],
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
