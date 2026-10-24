import typescriptEslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/.next/**",
            "**/dist/**",
            "**/out/**",
            "**/node_modules/**",
            "**/.vscode-test/**",
            "**/coverage/**",
            "**/temporary/**",
            "apps/web/**/public/draco/**",
        ],
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
                projectService: {
                    allowDefaultProject: [
                        "packages/core/test-read-directory.ts",
                        "packages/ui/vite.config.ts",
                    ],
                    defaultProject: "./tsconfig.eslint.json",
                },
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
];