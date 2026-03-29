# Changelog

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
