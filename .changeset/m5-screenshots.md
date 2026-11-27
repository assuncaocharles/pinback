---
'@assuncaocharles/pinback-core': minor
'@assuncaocharles/pinback': minor
---

Optional screenshots: when the auth worker has an R2 bucket, the composer offers "Attach screenshot". The page around the pinned element is captured by a lazily loaded module (pinback-capture.mjs), uploaded through the auth frame, verified and stored by the worker, and embedded in the comment.
