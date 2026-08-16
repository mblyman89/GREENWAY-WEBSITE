import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Build output of the packaged register app (Phase 0.3/0.4).
    // `npm run register:build` writes a minified bundle here, and
    // `npx cap sync` copies that same bundle into the native iOS project.
    // Neither is source, and linting minified output produces ~1,900
    // meaningless warnings that bury real ones. Both paths are already in
    // .gitignore; this keeps the lint gate honest whether or not a build
    // happens to be sitting on disk.
    "register-app/dist/**",
    "ios/App/App/public/**",
  ]),
]);

export default eslintConfig;
