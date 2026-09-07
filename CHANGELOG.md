# Changelog

History was reset at v1.0.0-beta.12. Earlier beta entries tracked a codebase
that has since been restructured, and describing the app as it stands is more
useful than a trail of superseded notes. This entry is a full feature summary
rather than a diff against beta.11.

The in-app changelog reads this file, so keep the shape: `## version — date`
(em dash), `### Section`, and `- ` bullets. Bullets outside a section are not
rendered, and the modal prints bullet text literally, so leave out bold and
backticks.

## v1.0.0-beta.12 — 7 September 2026

### SCA — Software Composition Analysis

- Repository graph of every package, severity-coded Critical / High / Medium / Low / Safe / Unscanned
- Version grouping collapses packages sharing a name into one node carrying the group's worst severity, taking a container repo from 292 nodes to 15
- Expand or collapse every group at once from the graph controls, or click a single group to inspect it
- Blast radius: dependency edges show which packages are transitively exposed to a finding
- Shared CVE edges link packages carrying the same vulnerability
- Attack path view from client tooling through the registry to a repository, package and CVE, with format-specific client examples
- Per-CVE cards with severity, affected and fixed versions, and NVD and GitHub Advisory links
- Most vulnerable packages listed per repository, clickable to jump to the node
- Self-contained HTML vulnerability reports per package, generated through vulnly

### CIEM — Cloud Infrastructure Entitlement Management

- Identity graph over repositories, members, service accounts, teams, entitlement tokens and upstream proxies
- Access and entitlement edges drawn as dashed curves, so permission paths read differently from structural ones
- Node panel showing role, email, permissions, status, team membership and every connected relationship grouped by edge type
- Filter by node type with live counts
- Prefixed search: repo, user, service, team, entitlement and upstream, or free text

### Tying SCA and CIEM together

- Package panel carries an exposure summary answering who can reach the repository holding this artifact
- Reachability tab on the package panel, with its own loading state so a slow access lookup never blocks the vulnerability data
- Jump straight from a package to the identity graph focused on its repository
- Access is fetched per repository rather than per package, so moving between packages in one repo is a single request

### Malware

- Status filter for packages flagged as malware
- Node indicator on both individual packages and the groups containing them
- Malware takes precedence over Critical wherever the two would compete for the same node
- Optional pulse animation, toggleable in settings alongside the critical animation
- An expanded group pulses on its child versions only, not on the open hub as well

### Workspace overview

- Every repository in a workspace as a single cross-repository graph
- Aggregate vulnerability statistics, package format heatmap and severity breakdown
- Cross-repository CVE search
- Connected repositories rendered as a distinct directional edge, and listed in the repository panel
- Same central node treatment, cursor behaviour and controls as the repository graph

### Graph rendering

- WebGL rendering through Sigma.js, holding a smooth frame rate into the thousands of nodes
- Plated node labels that stay legible against node imagery in both themes
- Hover tooltips carrying package format and, for container images, architecture
- Quarantine badge drawn above the selection ring rather than behind it
- Initial scatter spread by golden angle and stretched to the container's aspect ratio, so a wide window is filled rather than letterboxed and related packages do not bunch into one arc
- Node sizes scaled against available space on large repositories, replacing the browser zoom-out this needed before
- Fit graph control centres on the repository and zooms to show every node
- Five layouts: force-directed, circular, radial, tree and horizontal, with edge style following the layout

### Details panel

- Docked full height on the right; the graph and top bar make room rather than being covered
- Expands to full screen, where long lists reflow into columns
- Four tabs on a package: Details, Vulnerabilities, Dependencies and Reachability
- The Dependencies tab appears only where dependency data exists, since not every format reports it
- Distinct panels for packages, version groups, transitive dependencies and repositories
- Group panel lists every version worst-first with severity, type, architecture and tags, searchable by tag, which matters for Docker where the tag is the only readable part of a digest
- Package metadata per format: digests that copy on click, identifiers, tags, uploader, filename, architecture and distribution
- Metadata fetched on selection, keeping the graph payload small

### Search and filtering

- Severity filter is multi-select: Critical and High together, with no selection meaning everything
- Status filters for Vulnerable, Safe, Quarantined, Shared CVEs, Malware and Has dependencies, combined with AND or OR
- Safe means scanned and clean rather than merely no findings recorded, so formats that cannot be scanned are excluded
- Selecting a search result keeps that node and its neighbours visible instead of filtering them out
- Filters apply per node type across a result and its neighbours, so an active filter never hides the resource just selected
- Edges are retained through filtering
- Format filter isolates one package format from the repository panel

### Deployment

- Distroless container image on Chainguard, running as a non-root user with no shell or package manager
- Scans clean under Trivy at every severity
- Single container: the backend serves the built frontend, so there is no CORS to configure
- No API key is baked into the image; keys are entered in the browser under Settings, or supplied server-side by environment variable
- Multi-architecture image for linux/amd64 and linux/arm64, covering Windows through Docker Desktop
- Scan cache on a mounted volume, keyed on each package's scan completion time rather than a TTL, turning a cold build of several thousand packages into a local read
- build-image.sh builds and pushes with the tag taken from package.json and full OCI annotations
- bump-version.sh bumps the version that the footer, the backend and the image tag all read

### Settings and connection

- Connection moved into Settings as its own tab, replacing the separate dialog
- Settings shows the authorised user for the current credential
- Connection indicator reads green when connected
- API key validated against Cloudsmith before it is saved
- Workspace and repository selectors with per-namespace package counts
- Left control panel collapses for more graph space
