// @ts-check
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");

/** Shared flat ESLint config (ESLint 9+) for KORVA OS Node/TypeScript packages. */
module.exports = tseslint.config(
  { ignores: ["dist", "node_modules", ".next", "coverage"] },
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
);
