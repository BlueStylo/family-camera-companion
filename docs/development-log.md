# Development Log

## Before the Public Repository

The project started as a private, AI-assisted prototype for an ad-free family
camera app. Work included camera-adapter source, household-device approval,
local media storage, a 2D site plan and an editable Blender house model.

The owner repeatedly corrected model assumptions using reference photographs
and annotated plans. Key corrections included:

- Separate garage/storage volumes, connected roofs and short eaves.
- Non-rectangular land and a road-following retaining wall ending before the entry.
- A near-level inner vegetable plot with a flower border on only two sides.
- Centered facade windows, enlarged porch, connected decks and asymmetric stairs/rails.

Those private iterations are summarized here rather than recreated as historical
GitHub issues or backdated PRs. Reference materials are deliberately excluded.

## 2026-09-08: Public Extraction

- The owner authorized public display of the house model and selected MIT for
  code; the model reuse license remains a separate decision.
- A separate checkout was prepared without altering the private working copy.
- The public Blender model was rebuilt without source image references.
- Actual camera identifiers were removed; five illustrative virtual cameras
  demonstrate local PTZ interaction without hardware/network access.
- Real-device and family configuration moved behind required external paths.
- Issue #1 tracks the extraction, tests, privacy review and first implementation PR.
- Final metadata inspection found Blender's automatic file-path stamp in a
  candidate PNG despite no visible stamp. Publication was held. Public builds
  now disable stamp metadata; PNG metadata regression checks and full,
  uncompressed Blender scanning were added. EXIF and text metadata are removed
  without changing PNG pixel chunks, and the Blender file-browser directory is
  reset to a relative path. The earlier audit repository
  remains private and is not the source history of this public repository.

Implementation and checks are AI-assisted. Automated checks and maintainer
self-review are recorded as such, not as independent human or family validation.
