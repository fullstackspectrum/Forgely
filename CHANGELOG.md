# Changelog

## v1.0.0-beta.1 — 18 April 2026

### Core
- Cloudsmith API integration for packages, dependencies, and vulnerability scans
- FastAPI backend with in-memory caching
- React + Vite frontend with Sigma.js (WebGL/GPU) graph rendering
- `start.sh` startup script

### Graph Visualisation
- Force-directed, Radial, Tree, and Horizontal graph layouts
- Curved and straight edge style toggle
- Dependency nodes rendered as squares to distinguish from packages
- Dependency edges use a custom dotted WebGL shader with reduced opacity
- Repo→package edges styled with blue color at 2px thickness
- Shared CVE edges rendered in red
- Cloudsmith logo as the repo node icon via `@sigma/node-image`

### Search & Filtering
- Cloudsmith query-based package search (supports filters like `tag:openjdk`, package names, versions)
- CVE search for `CVE-*` / `GHSA-*` patterns with node highlighting
- Search hides unmatched nodes while keeping connected nodes and the repo node visible
- Left control panel with severity filters, layout switcher, and stats

### Organisation View
- Organisation-level graph showing repositories and their relationships
- Workspace selector with organisation-scoped filtering
- Dedicated left panel, side panel, and legend for organisation view

### Side Panel
- Package metadata, CVE cards, and advisory links
- "View in Cloudsmith" external link button
- Severity badge, vulnerability count, and external link in a status row

### UI
- Dark security-product theme with glassmorphism design
- Workspace and repository selector dropdowns (sorted alphabetically)
- Loading/refresh indicator scoped to the graph pane
- Version badge displayed in the bottom-right corner, sourced from `package.json`
