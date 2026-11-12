import typescriptEslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/.next/**",
            "**/dist/**",
            "**/out/**",
            "**/node_modules/**",
            "**/coverage/**",
            "**/temporary/**",
            "deprecated/**",
            "packages/plugins/*/src/**/*.test.ts",
            "packages/plugins/*/src/__tests__/**",
            "packages/plugins/*/src/__verification__/**",
        ],
    },
    {
        files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
        ignores: ["deprecated/**"],
        rules: {
            "no-restricted-imports": ["error", {
                paths: [
                    {
                        name: "@brud/core",
                        message: "The legacy core engine is quarantined in deprecated/ (D-14/D-17). Use @brud/kernel or a plugin.",
                    },
                    {
                        name: "@brud/vscode-adapter",
                        message: "The legacy VS Code adapter is archived in deprecated/ and rebuilt in Phase 13 (D-22).",
                    },
                ],
                patterns: [
                    {
                        group: ["@brud/core/*", "@brud/vscode-adapter/*"],
                        message: "The legacy core engine and adapter are quarantined in deprecated/ (D-14/D-17/D-22).",
                    },
                    {
                        group: ["deprecated", "deprecated/*", "**/deprecated/**"],
                        message: "Live code must not import from deprecated/ (D-14/D-17).",
                    },
                ],
            }],
        },
    },
    {
        linterOptions: {
            noInlineConfig: true,
            reportUnusedDisableDirectives: "error",
        },

        rules: {
            curly: "warn",
            eqeqeq: "warn",
            "no-throw-literal": "warn",
            semi: "warn",
        },
    },
    {
        files: ["**/*.{js,jsx,mjs,cjs}"],

        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
    },
    {
        files: ["**/*.{ts,tsx,mts,cts}"],

        plugins: {
            "@typescript-eslint": typescriptEslint.plugin,
        },

        languageOptions: {
            parser: typescriptEslint.parser,
            ecmaVersion: 2022,
            sourceType: "module",
            parserOptions: {
                project: ["./tsconfig.eslint.json"],
                tsconfigRootDir: import.meta.dirname,
            },
        },

        rules: {
            "@typescript-eslint/naming-convention": ["warn", {
                selector: "import",
                format: ["camelCase", "PascalCase"],
            }],

            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unsafe-assignment": "error",
            "@typescript-eslint/no-unsafe-argument": "error",
            "@typescript-eslint/no-unsafe-call": "error",
            "@typescript-eslint/no-unsafe-function-type": "error",
            "@typescript-eslint/no-unsafe-member-access": "error",
            "@typescript-eslint/no-unsafe-return": "error",
            "@typescript-eslint/ban-ts-comment": ["error", {
                "ts-check": false,
                "ts-expect-error": "allow-with-description",
                "ts-ignore": true,
                "ts-nocheck": true,
            }],
        },
    },
    {
        // Pre-existing test-harness debt: JSON-RPC and parser fixtures are
        // intentionally `any` at the boundary. Phase 11 does not change test
        // behaviour; this keeps the live gate focused on production sources.
        files: ["**/*.test.ts", "**/__tests__/**/*.ts", "**/__verification__/**/*.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-return": "off",
        },
    },
    {
        // Pre-existing Reader debt: the search response is narrowed with
        // `Array.isArray`, which preserves `any[]`. This is not a Phase 11
        // change and the Reader implementation is out of scope.
        files: ["packages/plugins/Reader/src/readEngine.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
        },
    },
];
