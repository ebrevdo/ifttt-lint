# Repository Guidelines

## Project Structure & Module Organization
The TypeScript sources live in `src/`, with `src/main.ts` exposing the CLI, `src/LintEngine.ts` coordinating diff parsing, and worker helpers in `src/parserWorker.ts`. Directive parsing and validation logic sits in `src/DirectiveParser.ts`, `src/DirectiveValidator.ts`, and shared types in `src/LintPrimitives.ts`. Custom ambient typings live under `src/types/`. Compiled artifacts land in `dist/` after the TypeScript build; keep this directory out of versioned edits. Unit tests reside in `tests/`, mirroring the source module layout, while performance benchmarks and shared harness utilities live in `perf/`.

## Build, Test, and Development Commands
- `npm install` – install all runtime and dev dependencies.
- `npm run lint` – run ESLint across `src`, `tests`, and `perf`.
- `npm run build` – lint, then emit JavaScript to `dist/` via `tsc`.
- `npm test` – execute Jest suites in `tests/` with `ts-jest`.
- `npm run perf` – run the benchmark harness in `perf/`.
- `npm run start -- <diff>` – invoke the compiled CLI against a diff or `-` for stdin.

## Coding Style & Naming Conventions
Write TypeScript with two-space indentation, trailing semicolons, and named exports for reusable modules. Prefer descriptive PascalCase filenames for classes (`DirectiveParser.ts`) and lowerCamelCase for functions and instances. Follow the existing directive terminology (`IfChange`, `ThenChange`, `Label`). ESLint is the source of truth—run `npm run lint` before submitting, and keep any intentional `console` usage limited to CLI logging in `src/logger.ts`.

## Testing Guidelines
Add or update Jest tests in `tests/**/*.test.ts`, using the module-under-test naming (`LintEngine.test.ts`). Co-locate fixtures within the test file or shared helpers under `tests/` when reuse is needed. Maintain or improve coverage by exercising both directive parsing and worker paths; run `npm test` locally, and rerun `npm run build` to ensure type safety. When changes touch performance-sensitive code (`src/parserWorker.ts`, `perf/**`), capture a before/after comparison with `npm run perf`.

## Commit & Pull Request Guidelines
Keep commit messages in imperative mood with concise scope (`Allow ThenChange to target IfChange labels (#17)`); reference related issues or PRs in parentheses. Squash commits that would otherwise be fixups. Pull requests should summarize the user-facing impact, list validation commands executed, note any perf results, and include reproduction steps for regressions. Attach diff samples when modifying directive syntax so reviewers can reason about cross-file effects.
