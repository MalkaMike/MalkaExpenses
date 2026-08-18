import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15.x ships legacy-format configs; FlatCompat bridges
// them into ESLint 9 flat config (official Next 15 migration pattern).
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/sw.js",
    ],
  },
  {
    // House rule: no silently swallowed errors. The ONLY sanctioned body-parse
    // swallow lives in lib/http.ts (safeJson) — everything else must log or
    // rethrow. `no-empty` catches `catch {}`; the restricted-syntax rule
    // catches `.catch(() => {})` / `.catch(() => ({}))` promise swallows.
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      // This codebase marks a deliberately unused argument by prefixing it with
      // an underscore (_req, _role). Without these patterns the linter flags the
      // very convention used to silence it, which trains people to ignore it.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0][body.type='BlockStatement'][body.body.length=0]",
          message:
            "Silent .catch(() => {}) is banned — log the error or use safeJson (lib/http.ts) for body parses.",
        },
      ],
    },
  },
  {
    files: ["lib/http.ts"],
    rules: { "no-empty": "off" },
  },
];

export default eslintConfig;
