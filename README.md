# IfThisThenThat Linter (ifttt-lint)

An open‑source implementation of Google's internal IfThisThenThat (IFTTT) linter tool. Enforce
atomic pull requests by declaring file dependencies in your code: _If this file changes, then that
file or region must also change._


![License](https://img.shields.io/badge/license-MPL%202.0-blue.svg)

## Features
- Declare **conditional change directives** with optional labels (e.g., `// LINT.IfChange`, `//
  LINT.IfChange('g')`, or `// LINT.IfChange("g")`).
- Specify **target files** or regions with `// LINT.ThenChange` pragmas (e.g., `// LINT.ThenChange(
  ['path/to/file1', 'path/to/file2#label'])` or `// LINT.ThenChange('path/to/file1')`).
- Support for **labeled regions** (`// LINT.Label('name') ... // LINT.EndLabel`) to constrain where
  changes must occur.
- True parallel parsing and linting across CPU cores using Node.js worker threads.
- CLI and **programmatic API** for integration in custom workflows.

## Example files

### Base file and targets

```bash
# path/to/Makefile
# important config bit
# LINT.IfChange
SOMEVAR = 1
# LINT.ThenChange(
#  ['path/to/py_config.py',
#   'path/to/ts_config.ts#foo'],
# )
```

```python
# path/to/py_config.py
SOMEVAR = 1
```

```typescript
// path/to/ts_config.ts
// LINT.Label('foo')
const SOMEVAR = 1;
// LINT.EndLabel
```

### Cross-referencing files
```python
# path/to/file1.py
# LINT.IfChange('foo')
class Blah(Enum):
    FOO = 1
    BAR = 2
# LINT.ThenChange('path/to/file2.json#bar')
```

```json
/* path/to/file2.json */

// LINT.IfChange('bar')
{
  "foo": 1,
  "bar": 2
}
// LINT.ThenChange('path/to/file1.py#foo')
```

## Installation
Install via npm (when published):
```bash
npm install -g ifttt-lint
```
Or add to your project as a dev dependency:
```bash
npm install --save-dev ifttt-lint
```

## CLI Usage Examples

```bash
# From a patch file:
$ ifttt-lint path/to/changes.diff

# From stdin, ignoring all .bak files
$ git diff HEAD~1 | ifttt-lint -i '**/*.bak' -
```
The CLI prints debug info to stderr and exits with:
- `0` if no lint errors
- `1` if any conditional lint failures
- `2` on fatal errors (e.g., missing input)

### Example (verbose)
```bash
$ cat sample.diff | ifttt-lint --verbose -
Parallelism: 8
Processing changed file: src/foo.ts
Finished processing changed file: src/foo.ts
Processing target file: src/bar.ts
Finished processing target file: src/bar.ts
[ifttt] src/foo.ts#feature:10 -> ThenChange 'src/bar.ts' (line 12): target file 'src/bar.ts' not changed.
```

## Developer Guide
Clone, install dependencies, and build (requires Node.js >=12 for worker_threads):
```bash
$ git clone https://github.com/your-org/ifttt-lint.git
$ cd ifttt-lint
$ npm install
$ npm run build
```

Run tests:
```bash
$ npm test
```
Run performance benchmark:
```bash
$ npm run perf
```
Start linting locally:
```bash
$ npm run start -- path/to/changes.diff
```

The project structure:
- `src/` - TypeScript source modules
- `dist/` - Compiled JavaScript output
- `tests/` - Jest unit tests

## GitHub Actions Integration

To run `ifttt-lint` automatically on pull requests, add a GitHub Actions workflow (e.g., `.github/workflows/ifttt-lint.yml`) with the following configuration:

```yaml
name: IFTTT Lint

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
        with:
          fetch-depth: 0      # Fetch full history for merge-base
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "23"  # or your preferred version
      - name: Install IFTT-lint
        run: npm install -g ifttt-lint
      - name: Validate lint pragmas
        run: ifttt-lint --verbose --scan .
      - name: Compute diff from common ancestor
        run: |
          BASE_SHA=${{ github.event.pull_request.base.sha }}
          MERGE_BASE=$(git merge-base HEAD $BASE_SHA)
          git diff $MERGE_BASE HEAD > changes.diff
      - name: Run IFTTT Lint
        run: npx ifttt-lint -i '**/*.md' changes.diff
```

This workflow computes the diff from the common ancestor between the PR branch (`HEAD`) and the base branch, saves it to `changes.diff`, and runs `ifttt-lint` against that diff.

## Contributing
1. Fork the repo
2. Create a branch (`git checkout -b feature/xyz`)
3. Write code & tests
4. Ensure all tests pass (`npm test`)
5. Submit a Pull Request

---
_Licensed under the Mozilla Public License, v. 2.0. See LICENSE for details._
