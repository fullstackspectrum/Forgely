# Changelog

## v1.0.0-beta.10 — 1 May 2026

### SCA / CIEM Rebranding
- Renamed the "Artifacts" tab to **SCA** (Software Composition Analysis)
- Renamed the "Workspace" tab to **CIEM** (Cloud Infrastructure Entitlements Management) with a lock icon
- Synced SCA/CIEM tab names throughout `OrgLeftPanel`
- Forgely logo now used for the org node in the CIEM graph

### Workspace Overview
- New workspace node panel with a full repo list, severity breakdown, and cross-repo CVE search
- Layout and edge style controls added to workspace overview (shared `LayoutPopout` component)
- Workspace-overview loading state with contextual stage labels and patience messages
- Repo node sizes now use a log scale with a wider size range for clearer visual hierarchy
- Selecting a repo hides unrelated nodes and edges to focus the graph
- Repo list in the workspace panel sorted by vulnerability count descending
- CVE list in the repo panel paginated: 10 items collapsed, 35 when expanded
- Collapsed repo panel auto-sizes to fit 10 CVEs; expands to a grid layout
- Severity filter pills added to the workspace repo CVE panel
- Filter panel disabled automatically when workspace overview is active
- Format heatmap replaced with repo-format cards using [devicon](https://devicon.dev/) icons
- Multi-select package format filter with graph dimming for unmatched repos
- Selecting a repo in workspace overview auto-applies its CVE search query

### Performance
- Workspace overview cached in the frontend to avoid redundant fetches
- Backend parallelism improved for faster workspace overview load times

## v1.0.0-beta.4 — 21 April 2026

### Vulnly Integration
- Integrated [vulnly](https://pypi.org/project/vulnly/) to generate self-contained HTML vulnerability reports
- New backend endpoint `GET /api/vulnly-report/{owner}/{repo}/{slug}` fetches the latest Cloudsmith scan, pipes it through `vulnly --source cloudsmith`, and streams the rendered HTML
- "Vulnly Report" button in the package side panel opens the report in a new tab
  - Red variant for vulnerable packages, green variant for clean-scanned packages
  - Inline spinner while generating, with error messaging on failure
- Added `vulnly>=1.0.0b8` to `backend/requirements.txt`

### Side Panel
- Added a Dependencies section listing direct dependencies of the selected package
- Summary card shows the total count and toggles the dependency list open/closed
- Each dependency row shows name, version, and a severity-coloured vulnerability badge
- Clicking a dependency selects it in the graph and refocuses the panel

## v1.0.0-beta.3 — 20 April 2026

### Branding
- Rebranded from Artigraphly to **Forgely**
- New Forgely logo across the frontend, backend, README, and startup script
- Updated page title, favicon, and in-app logo references

## v1.0.0-beta.2 — 18 April 2026

### Graph Visualisation
- Animated pulsing effect on critical vulnerability nodes for clearer at-a-glance risk

### UI
- Repositioned version badge and adjusted the connection button placement
- Refined `FilterBar` and `OrgLeftPanel` layouts for better spacing

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

