import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "artifacts/**", "tmp/**"],
  },
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      react: {
        version: "19.3.0",
      },
    },
  },
];

export default eslintConfig;
