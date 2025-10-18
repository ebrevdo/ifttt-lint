# Release Playbook

## Overview
Releases now happen in two stages:
1. **open-pr** – run the workflow to generate a draft release pull request (PR) with the version bump. You review and merge that PR after updating the changelog.
2. **publish** – rerun the workflow after the PR merges to tag `vX.Y.Z` and publish the GitHub release.

## Stage 1 – Prepare The Release PR (`stage=open-pr`)
- Update `CHANGELOG.md` locally (if you already know the notes) or plan to edit it in the upcoming PR.
- Navigate to GitHub → **Actions** → **Manual Release** → **Run workflow**.
- Inputs:
  - `version`: semantic version without the leading `v` (e.g. `0.2.0`).
  - `notes`: optional text to include in the PR checklist (and later appended to the release).
  - `stage`: leave as `open-pr`.
  - `dry_run`: set `true` to rehearse without creating a PR.
- The workflow installs dependencies, runs lint/tests/build, runs `npm version`, and (when `dry_run=false`) opens a draft PR `release/vX.Y.Z` using `peter-evans/create-pull-request`.
- Edit the PR:
  - Add/update `CHANGELOG.md` so it contains `## vX.Y.Z`.
  - Mark the checklist items complete, convert the draft to ready, and run CI if you make manual edits.
  - Merge the PR into `main` once it’s ready.

### CLI example (Stage 1)
```sh
gh workflow run manual-release.yml --ref main \
  -f version=0.2.0 \
  -f stage=open-pr \
  -f dry_run=false
```

## Stage 2 – Publish The Release (`stage=publish`)
- Confirm the release PR has merged and `main` now contains the updated version and changelog heading.
- Trigger **Manual Release** again with:
  - `version`: the same version you just merged.
  - `notes`: optional extra Markdown appended to the release body.
  - `stage`: change to `publish`.
  - `dry_run`: set `true` if you want to run validations (lint/test/build/changelog check) without tagging or publishing.
- The workflow reruns lint/tests/build, verifies `CHANGELOG.md` contains the version heading, confirms `package.json`/`package-lock.json` already match the input version, creates `vX.Y.Z`, and (when `dry_run=false`) pushes the tag and publishes the release via `softprops/action-gh-release`.
- Because the job targets the `Production Release` environment, GitHub pauses and requests your approval before pushing tags or publishing; approve to continue.

### CLI example (Stage 2)
```sh
gh workflow run manual-release.yml --ref main \
  -f version=0.2.0 \
  -f stage=publish \
  -f notes="Parser speedups" \
  -f dry_run=false
```

## Dry Runs
- Set `dry_run=true` in either stage to exercise the pipeline without side effects.
- Stage 1 dry run stops after printing the pending changes (no PR created).
- Stage 2 dry run still creates the local tag inside the runner, but skips pushing and the GitHub release.
- Inspect the logs; rerun with `dry_run=false` when ready.

## Troubleshooting
- **Missing changelog heading (publish stage)**: add `## vX.Y.Z` to `CHANGELOG.md` on `main` (via the release PR) before rerunning.
- **package.json mismatch (publish stage)**: ensure the release PR merged successfully; rerun Stage 1 if necessary.
- **Existing tag**: delete or rename the conflicting tag, then rerun Stage 2.
- **PR already exists**: close or merge the previous release PR before rerunning Stage 1, or delete the `release/vX.Y.Z` branch.
