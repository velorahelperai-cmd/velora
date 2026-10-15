import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "artifacts/**", "tmp/**"],
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Explicit unused API arguments and fields omitted from an object-rest
      // comparison are intentional; all other unused symbols still block CI.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    settings: {
      react: {
        version: "19.3.0",
      },
    },
  },
];

export default eslintConfig;
