import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

const boundaryMessage =
  "packages/domain must stay framework-free: depend on domain ports, not AWS, Lambda, Node I/O or the worker adapter.";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.local/**",
      "**/.terraform/**",
      "**/.knowledge/**",
      "**/.orchid/**",
      "**/.opencode/**",
      "templates.manifest.json",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
  {
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "aws-lambda", message: boundaryMessage },
            { name: "node:fs", message: boundaryMessage },
            { name: "node:fs/promises", message: boundaryMessage },
            { name: "node:http", message: boundaryMessage },
            { name: "node:https", message: boundaryMessage },
            { name: "fs", message: boundaryMessage },
            { name: "fs/promises", message: boundaryMessage },
            { name: "http", message: boundaryMessage },
            { name: "https", message: boundaryMessage },
            { name: "@printer/render-worker", message: boundaryMessage },
          ],
          patterns: [
            { group: ["@aws-sdk/*"], message: boundaryMessage },
            { group: ["@printer/render-worker/*"], message: boundaryMessage },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression > Literal[value=/^(@aws-sdk\\/|aws-lambda$|node:fs$|node:fs\\/promises$|node:http$|node:https$|@printer\\/render-worker)/]",
          message: boundaryMessage,
        },
      ],
    },
  },
  eslintConfigPrettier,
);
