# Release Playbook

## Prerequisites
- Update `CHANGELOG.md` with a heading for the version you plan to cut (`## vX.Y.Z` or `## X.Y.Z`).
- Merge all release-ready changes into `main`.
- Decide on release notes; optional extra copy can be supplied when triggering the workflow.

## Cut a Release
1. Navigate to GitHub → **Actions** → **Manual Release**.
2. Click **Run workflow**, confirm the branch is `main`, and fill in:
   - `version`: semantic version without the `v` prefix (e.g. `1.4.0`).
   - `notes` (optional): text appended to the generated release notes.
   - Leave `dry_run` as `false`.
3. The workflow runs `npm ci`, `npm run lint`, `npm test`, and `npm run build`, checks that `CHANGELOG.md` contains the version heading, bumps `package.json`/`package-lock.json` to the requested version, commits `Release <version>`, creates tag `v<version>`, pushes the commit and tag to `origin`, and publishes the GitHub release via `softprops/action-gh-release`.
4. After the job succeeds, verify:
   - `CHANGELOG.md` on `main` now includes the version and matches what you expect.
   - A new annotated tag `v<version>` exists on GitHub.
   - The GitHub Release page shows the generated notes plus any appended text.
5. The job targets the `Production Release` environment; GitHub will pause and request your approval (only you are listed as an approver) before the job runs. Approve the deployment to proceed.

## CLI Trigger
You can run the same workflow from a local terminal with GitHub CLI (example uses dry_run):

```sh
gh workflow run manual-release.yml --ref main \
  -f version=0.1.0 \
  `#-f notes="Parser tweaks"` \
  -f dry_run=true
```

Use `gh run watch` or open the Actions tab to follow progress.

## Dry Run
- To validate the pipeline without publishing, set `dry_run` to `true` (via the Actions UI or `-f dry_run=true` with `gh workflow run`).
- The workflow still installs, lints, tests, builds, checks `CHANGELOG.md`, runs `npm version`, and creates a local tag, but it skips pushing the commit/tag and creating the release.
- Inspect the job logs to confirm the steps you expect would succeed, then re-run with `dry_run=false` when ready to publish.

## Troubleshooting
- **CHANGELOG check fails**: ensure `CHANGELOG.md` contains a heading that matches the version (leading `v` optional), commit the update to `main`, and re-run.
- **Tests or build fail**: fix the underlying issue on `main`, verify locally with `npm test` and `npm run build`, then rerun the workflow.
