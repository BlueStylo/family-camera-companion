# Contributing

## Workflow

1. Open an issue describing the problem, evidence, non-goals and acceptance checks.
2. Use a `feat/`, `fix/` or `chore/` branch.
3. Make a scoped change and run `npm ci && npm run check`.
4. Open a PR with `Closes #issue`, test evidence and remaining limitations.
5. Wait for CI; review the diff and model assets before squash-merging.

No backdated issues, invented user tests or retrospective PR history. Work
completed before this repository is described as the initial private prototype.
AI-assisted implementation is welcome, but identify automated tests and
self-review accurately. Do not label them as an independent human review.

## Privacy Gate

- Never add device addresses, serial numbers, QR codes, credentials, family
  contact data, authentication databases, recordings or raw device logs.
- Never add original photos or satellite/road-view screenshots, including
  hidden Blender image references and GitHub issue attachments.
- Reproduce bugs with synthetic fixtures. Use reserved documentation addresses,
  not a household network address.
- Keep all live configuration and storage **outside this checkout**.
- `npm run check:privacy` checks file types, common sensitive patterns and
  reviewed model hashes. This is a guardrail, not proof of anonymity.
- For model changes: rebuild, run the Blender verifier, inspect both renders and
  embedded assets, then run `node scripts/seal-model.mjs` and review the hash diff.
  Do not reseal an unexplained binary merely to make CI green.

## Model Changes

See MODEL_LICENSE.md before modifying or reusing supplied house assets.
Keep 2D and 3D geometry consistent; update regression tests when a reviewed
shape changes. Approximate dimensions must remain marked as estimates.
