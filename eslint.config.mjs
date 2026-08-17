import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    // eslint-config-next leaves no-undef off, on the assumption that TypeScript
    // catches unresolved identifiers. This project is plain JavaScript, so
    // nothing caught `{m.applyError}` in AIChatPanel — a ReferenceError thrown
    // from render on the flagship "apply AI proposal" path, which took down the
    // whole app because there is no error boundary above it.
    rules: {
      "no-undef": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
