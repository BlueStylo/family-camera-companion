# Architecture and Evidence Boundaries

## Two Separate Runtimes

```text
Public demo
  browser -> static public/ files -> GLB + Three.js scene
                                   -> local synthetic PTZ state
  No real camera API, login, cloud relay or device configuration.

Optional private adapter prototype
  approved family browser -> Node HTTP server -> ONVIF / RTSP / FFmpeg
                               |
                               + external family config + SQLite sessions
                               + external camera inventory
                               + external snapshots / manual recordings
```

Only the house geometry is intentionally public. Camera poses in the demo are
illustrative and do not reproduce the actual deployment. No cloud secrets or
camera settings are needed to build, test or inspect the public demo.

The 2D plan, Blender builder and JavaScript tests share
`public/assets/site.json`. Blender produces an editable `.blend` plus a merged
GLB for browser rendering. The public builder starts from an empty scene and
uses only two procedural textures. It never opens source photos.

## Optional Private Server

The existing adapter source is preserved as an experimental integration path,
not a claim of universal ONVIF support. It currently assumes IPv4, HTTP ONVIF
port 8899 and fixed profile tokens. It does not implement general authenticated
ONVIF discovery, vendor-cloud login, intercom or SD-card playback.

The inventory endpoint describes adapter features, **not detected device
capabilities**. Stream descriptors remain unverified until private discovery.
Device and family configuration paths must be absolute and outside the repo.
Missing configuration causes startup to fail; no built-in camera is contacted.

The public demo and this private adapter are not the same process. Running
`npm run dev` never starts the adapter.

## Access and Storage

Family phone values identify preconfigured members; they do not prove phone
ownership. A new browser requests approval, an administrator approves it, and
the browser claims a session using its private request cookie. Session tokens
are hashed at rest. Approval and claim are separate operations.

SQLite tests exercise expiration, revocation, role boundaries and restart.
Synthetic HTTP tests exercise approval, media downloads and byte ranges.
FFmpeg tests use generated color/audio sources, not a camera.

The server must stay on loopback behind an explicitly configured, authenticated
private-access/TLS boundary. Merely setting PUBLIC_ORIGIN does not create TLS
or a VPN. Deployment, proxy trust, abuse resistance and physical-camera PTZ
stop behavior require additional review and field tests.

## Model Accuracy

The model was refined through owner-supplied photos and marked-up plans:
connected roofs, window alignment, porch size, stairs, retaining wall, entry
gate and an L-shaped flower border. It is not a surveyed drawing. Interior
rooms, precise measurements and cadastral boundaries are not verified.

Repository geometry tests demonstrate consistency with the agreed model data,
not agreement with an independently measured building.
