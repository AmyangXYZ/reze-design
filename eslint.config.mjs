import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The chrome's controls are the components/ui primitives — Button and Input
  // have a `bare` variant for rows, tiles and inline fields that bring their
  // own look. Raw elements opt out of focus handling and disabled states.
  // Allowed: hidden <input type="file"> pickers. Anything else carries an
  // eslint-disable with its reason. Class-level scales: scripts/check-chrome.mjs.
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["components/ui/**", "app/admin/**"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        { selector: "JSXOpeningElement[name.name='button']", message: 'Use <Button> (variant="bare" for a row, tile or swatch).' },
        { selector: "JSXOpeningElement[name.name='textarea']", message: "Use <Textarea>." },
        {
          selector: "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value='file']))",
          message: 'Use <Input> (variant="bare" for an inline field).',
        },
      ],
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
