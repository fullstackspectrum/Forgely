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
- Custom curved dotted edge program (`EdgeCurvedDottedProgram`) with pixel-space dash spacing along Bezier curves
- Increased dash density on the straight dotted edge program for clearer rendering on long edges

### Search & Filtering
- Cloudsmith query-based package search (supports filters like `tag:openjdk`, package names, versions)
- CVE search for `CVE-*` / `GHSA-*` patterns with node highlighting
- Search hides unmatched nodes while keeping connected nodes and the repo node visible
- Left control panel with severity filters, layout switcher, and stats
- Workspace graph search with query prefix support (`repo:`, `user:`, `team:`, `service:`, `entitlement:`, `upstream:`) and plain text matching

### Organisation View
- Organisation-level graph showing repositories and their relationships
- Workspace selector with organisation-scoped filtering
- Dedicated left panel, side panel, and legend for organisation view
- Card-based workspace side panel with hero header, status pills, stat cards, info cards, and grouped connections
- Collapsible connection groups with totals; clicking a connection navigates to that node on the graph
- Fixed team-member associations: users and services in teams are now correctly linked
- Repository privilege/access edges from users, services, and teams to repos
- Access edges rendered as faint curved dotted lines to distinguish from structural edges
- Fixed Cloudsmith API response unwrapping for team members and repository privileges (handles both string-slug and dict response formats)

### Side Panel
- Package metadata, CVE cards, and advisory links
- "View in Cloudsmith" external link button
- Severity badge, vulnerability count, and external link in a status row
- Expand/collapse toggle to widen the panel to 75% of the viewport (smooth transition)
- Toggle available on both the artifacts graph and workspace graph panels

### UI
- Dark security-product theme with glassmorphism design
- Workspace and repository selector dropdowns (sorted alphabetically)
- Loading/refresh indicator scoped to the graph pane
- Version badge displayed in the bottom-right corner, sourced from `package.json`
- Collapsible/pinnable left panel with smooth slide transition
- "Packages" tab renamed to "Artifacts"

