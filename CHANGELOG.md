# Changelog

All notable changes to this project are documented here.

## [0.1.0] - 2025-10-18
### Added
- Allow `ThenChange` pragmas to reference labeled `IfChange` blocks across files without spurious failures.

### Changed
- Resolve `ThenChange` targets up front so the lint engine reuses canonical paths during analysis.
- Tighten change detection to look at lines inside `IfChange` blocks, ensuring edits between pragmas trigger their paired `ThenChange`.
- Upgrade the TypeScript toolchain (`typescript@5.6.3`, `jest@30.2.0`, `ts-jest@29.4.5`, `@types/jest@30.0.0`) to stay current with upstream releases.

### Fixed
- Accept diff inputs that contain only deletions, preventing false `Invalid diff` errors in CI integrations.
- Ensure label ranges derived from `IfChange` pragmas include the spans between `IfChange` and `ThenChange`, so missing-change errors cite the right lines.
- Prevent false positives for cross-file `ThenChange` references by only requiring updates when lines inside the originating `IfChange` block change.
