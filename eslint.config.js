import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// ESLint v9 flat config. The project ships eslint v9 + typescript-eslint v8 +
// the react-hooks/react-refresh plugins but had no config file, so `npm run
// lint` errored out ("couldn't find eslint.config.js"). This restores it using
// only the already-installed packages (no @eslint/js / globals / typescript-
// eslint meta-package needed). `no-undef` is intentionally NOT enabled — the
// TypeScript compiler already resolves identifiers, and typescript-eslint
// recommends leaving it off to avoid false positives on browser/node/test
// globals.
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "**/*.config.js",
      "**/*.config.ts",
      "cli-miner.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2021,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: {
      // Flag eslint-disable comments that no longer suppress anything (keeps
      // dead directives from accumulating). Relaxed for tests below.
      reportUnusedDisableDirectives: "error",
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // `any` is used deliberately across the low-level GPU / Electrum / crypto
      // interop layers; enforcing explicit types there is a separate, larger
      // typing effort, so don't fail lint on it.
      "@typescript-eslint/no-explicit-any": "off",
      // Respect the `_`-prefix convention the codebase already uses for
      // intentionally-unused params/vars/catch bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Allow `@ts-ignore` / `@ts-expect-error` only when they carry an
      // explanatory comment.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
        },
      ],
    },
  },
  // Test files get a relaxed profile: scratch helpers/vars, deep `require()`
  // imports for reaching into library internals, and the occasional vestigial
  // disable directive are common in the suite and not worth failing CI over.
  // Application code above stays strict.
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.{test,spec}.{ts,tsx}"],
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
