# Optional Private Adapter: Experimental

Do not expose this server directly to the public internet. This source is
included for review and further development, not as a production installer.
It is separate from the static demo, and this public extraction has not been
validated against actual cameras.

## Prerequisites

- Node 22.22+ or Node 24.
- FFmpeg installed separately for video and recording.
- An authorized private network path to owned cameras.
- Device compatibility with the assumptions in [architecture.md](architecture.md).

Keep configuration and storage outside the checkout. Set these environment
variables to absolute paths:

| Variable | Contents |
| --- | --- |
| CAMERAS_FILE | A private JSON array of camera objects |
| FAMILY_MEMBERS_FILE | A private JSON array of authorized family members |
| PRIVATE_DIR | Private SQLite state directory |
| RECORDINGS_DIR | Optional external media directory; otherwise PRIVATE_DIR/01_Media |
| PORT | Optional HTTP port; default 3000 |
| HOST | Keep 127.0.0.1 unless a separately reviewed deployment requires otherwise |
| PUBLIC_ORIGIN | HTTPS origin for an independently configured reverse proxy; not a TLS setup command |

Camera schema example uses a reserved documentation IP. **It is not a working
camera** and is not auto-loaded:

```json
[{"id":"camera-1","name":"Camera 1","ip":"192.0.2.10"}]
```

Family schema example uses a synthetic test phone, not an initial account:

```json
[{"id":"owner","name":"Example owner","phone":"01000000001","role":"admin"}]
```

After independently preparing private files and exporting the variables:

```sh
npm run server
# In another terminal with the same private configuration:
npm run access -- list
npm run access -- approve APPROVAL_CODE
```

Confirm the requesting person and their displayed code before approval.
Do not put real configuration in Git, an issue, a PR, a CI secret or a screenshot.
Never use the synthetic example account for an actual household.

## Known Gaps

Camera credentials/discovery and protocol differences need device-by-device
validation. PTZ timeouts must be checked on physical devices and network loss.
Server-side resource limits and reverse-proxy boundaries need further review.
No live audio, two-way talk, SD-card history, safety-event AI or unattended
production operation is claimed.
