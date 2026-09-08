# Validation Record

## 2026-09-08: Public Extraction, Local Checks

Environment: macOS, Node 22.22.3, Blender 5.2.0 LTS, Chromium via Playwright.
Tests were run against this separate public checkout, not the private deployed
camera system.

| Check | Observed result |
| --- | --- |
| Node tests | 33 passed, zero failed or skipped; geometry, auth, synthetic FFmpeg, PTZ, HTTP boundaries and PNG metadata regressions |
| Blender reopen/verify | Connected planar roof, facade alignment, stair/rail opening, gate, L-border and boundary checks passed |
| Packed images | Exactly 2 procedural textures; no photo-reference empties or collection |
| GLB | Embedded assets, expected layers and site IDs, no adjacent plot; texture PNG metadata permits only the reviewed fixed resolution block |
| Desktop browser | 1440 × 1000; model/plan, orbit, PTZ movement/stop, zoom and camera switch checked |
| Mobile browser | 390 × 844; model/plan and PTZ checked; document width matches viewport |
| Canvas pixels | Main scene and virtual camera contain varied pixels, not blank frames |
| Interactivity | Orbit and PTZ produce different rendered frames; release stops simulated motion |
| Network | Only local static files and embedded texture blobs during the demo test |
| Browser console | No errors on a fresh load after correcting the local texture CSP |
| Public audit | Reviewed file list, patterns, model hashes, site data, GLB metadata, uncompressed Blender bytes and PNG metadata checked |

Screenshots used for visual review remain local QA artifacts, not reference
photographs. The README image is a render of the public model itself.

## What This Does Not Establish

- No real camera, PTZ motor, vendor cloud or remote VPN was exercised in this extraction.
- No safety claim, field accuracy measurement or parent usability study.
- No production authentication/security audit or deployment/load certification.
- CI checks do not independently inspect all Blender contents; reviewed binary
  hashes detect changes after the separate Blender and visual verification.
- Removing location fields does not make the intentionally public house shape anonymous.

Later PRs should add their actual commands, evidence and failures without
rewriting this initial validation as broader than it was.
