import path from "node:path";
import { fileURLToPath } from "node:url";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", "src/__tests__/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
