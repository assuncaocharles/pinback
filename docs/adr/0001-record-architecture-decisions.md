# 1. Record architecture decisions

Date: 2026-11-27
Status: Accepted

## Context

preview-pins makes several decisions that aren't visible in the code alone
(security boundaries, storage format, anchoring trade-offs). Contributors need
to know why things are the way they are.

## Decision

Record significant decisions as short ADRs in `docs/adr/`, numbered
sequentially, using the sections Context, Decision, Consequences. Superseded
ADRs stay in place with their status updated.

## Consequences

A decision that changes the public format, security model or package
boundaries needs an ADR in the same PR.
