# Changelog

## v0.4.0 — 29 March 2026 (alpha/2.0)

### Search & Filtering
- Added Cloudsmith query-based package search (supports filters like `tag:openjdk`, package names, versions)
- Search now hides unmatched nodes in the graph while keeping connected nodes (shared CVEs, dependencies) and the repo node visible
- CVE search still supported for `CVE-*` / `GHSA-*` patterns

### Node & Edge Styling
- Dependency nodes now render as squares (`@sigma/node-square`) to distinguish from packages
- Dependency edges use a custom dotted WebGL shader (`EdgeDottedProgram`) with 0.4px thickness and 50% opacity gray
- Repo→package edges thickened to 2px with blue color
- Shared CVE edges remain red

### Side Panel
- Added "View in Cloudsmith" external link button in the package detail panel header
- Links to `app.cloudsmith.com/{owner}/r/{repo}/package-group/{format}/{name}/{slug_perm}`
- Redesigned panel header: title/version stacked, severity badge + vulnerability count + external link in a status row
- Moved vulnerability count out of metadata grid into the status row

### Edge Style Toggle
- Edge style toggle (curved/straight) no longer affects dependency edges — they stay dotted

## v0.3.0 — 29 March 2026

- Added Tree and Horizontal graph layouts (BFS-based hierarchical positioning)
- Loading/refresh indicator now scoped to the graph pane instead of full-screen overlay
- Workspace and repository dropdowns are now sorted alphabetically
- Added Cloudsmith logo as the repo node icon via `@sigma/node-image`
- Added logo banner to README

## v0.2.0

- Migrated from Pyvis (CPU) to Sigma.js (WebGL/GPU) with React + Vite frontend
- Added FastAPI backend with Cloudsmith API client and in-memory caching
- Added workspace and repository selector dropdowns
- Added left control panel with severity filters, layout switcher, and stats
- Added CVE search with node highlighting
- Added side panel with package metadata, CVE cards, and advisory links
- Added curved edges via `@sigma/edge-curve`
- Added dark security-product theme with glassmorphism UI
- Created `start.sh` startup script

## v0.1.0

- Initial Python CLI tool (`artigraphly.py`) using Pyvis for graph generation
- Cloudsmith API integration for packages, dependencies, and vulnerability scans
