# How to Use Forgely

Forgely covers two cloud-native security disciplines in a single tool:

| Tab | Domain | What it shows |
|-----|--------|---------------|
| **SCA** | Software Composition Analysis | Package vulnerabilities, CVEs, blast radii, attack paths |
| **CIEM** | Cloud Infrastructure Entitlement Management | Identity relationships, access entitlements, team structure |

---

## 1. Connect Your API Key

1. Launch Forgely (`./start.sh`) and open **http://localhost:3000** in your browser
2. Click the **Connect** button in the left panel
3. Paste your Cloudsmith API key — [generate one here](https://app.cloudsmith.com/user/settings/api/)
4. The key is validated against the Cloudsmith API before saving
5. Once connected, the workspace dropdown will populate with your available organisations

> To disconnect, click the **Disconnect** button at the bottom of the left panel.

---

## 2. Select a Workspace and Repository

1. Use the **Workspace** dropdown in the top bar to select your Cloudsmith organisation
2. Use the **Repository** dropdown to select a repository
3. Click **Go** — the SCA artifact graph will load and render
4. Alternatively, click **Workspace Overview** to load a cross-repository SCA view for the whole organisation

---

## 3. SCA — Software Composition Analysis

The SCA tab visualises the vulnerability posture of a single repository as an interactive graph. Each node represents a package or dependency; edges represent dependency or shared-CVE relationships.

### Navigation

- **Pan** — click and drag the canvas, or use the directional arrow controls
- **Zoom** — scroll wheel, or use the +/− zoom controls
- **Recenter** — click the recenter button to reset the viewport

### Interacting with Nodes

- **Hover** — nodes glow and enlarge; connected edges stay highlighted while others dim
- **Click** — opens a floating details panel showing package name, version, format, severity, CVEs, and dependencies
- **Drag panel** — the detail panel can be repositioned anywhere on screen
- **Right-click** — context menu with quick actions (e.g. generate vulnerability report)

### Filtering

- **Severity filters** — use the left panel to filter by Critical, High, Medium, or Low
- **Status filters** — toggle Vulnerable, Safe, Quarantined, Shared CVEs, Has Dependencies
- **Filter mode** — switch between AND/OR logic when combining multiple status filters
- **Format filter** — click a format card in the repo panel to isolate packages of that type

### Visibility Toggles

- **Shared CVE edges** — show/hide edges connecting packages that share a CVE
- **Dependency nodes** — show/hide dependency relationships
- **Unscanned packages** — show/hide packages without vulnerability data
- **Critical animation** — toggle the pulsing ring effect on Critical-severity nodes

### Layout

Use the layout switcher to change graph arrangement:

| Layout | Description |
|--------|-------------|
| Force | ForceAtlas2 — organic clustering by connection gravity |
| Circular | All nodes in a circle |
| Radial | Repository at centre, packages orbit outward |
| Tree | Hierarchical top-down |
| Horizontal | Left-to-right tree |

### Search

Use the search bar to find packages by name or CVE ID. Matching nodes are highlighted in the graph, all others are dimmed.

---

## 4. SCA — Workspace Overview

The Workspace Overview provides an organisation-wide SCA summary without loading individual repository graphs.

1. Select a workspace in the top bar
2. Click **Workspace Overview** — all repositories are fetched and scanned in parallel
3. Each repository appears as a node; the central node represents the organisation
4. Node size reflects the number of packages; node colour reflects the highest-severity CVE

### Canvas interactions

- **Click a repo node** — opens the repo detail panel; all other nodes are hidden to focus your view
- **Click the central node** — opens the workspace summary panel with aggregate stats
- **Right-click a repo node** — "Load Full Graph" to drill into that repository's full SCA graph
- **Click the canvas background** — deselects and restores all nodes

### Workspace summary panel (central node)

- Total packages, vulnerabilities, and unique CVEs across all repositories
- Severity breakdown bar (Critical / High / Medium / Low / Safe)
- Package format heatmap showing the distribution of formats across the workspace
- Repo list sorted by vulnerability count — click any row to open its detail panel
- Search bar: type a CVE ID, package name, or repo name to find which repositories are affected; results are repo-centric, showing matched CVEs and packages per repo

### Repo detail panel

- Per-repository vulnerability stats and severity bar
- CVE list paginated at 10 (collapsed panel) or 35 (expanded panel)
- Severity filter pills — filter CVEs by Critical / High / Medium / Low
- Text search — filter by CVE ID or package name
- **Load Full Graph** — drills into the full SCA graph for that repository

---

## 5. View Attack Paths

1. Click any package node to open its detail panel
2. Click the **Attack Path** button
3. A modal displays the full attack chain: **Client Tools → Internet → Registry → Repository → Package → CVE**
4. Client tools are format-specific (e.g. `docker pull`, `pip install`, `npm install`, `cloudsmith download`, Web UI)

---

## 6. CIEM — Cloud Infrastructure Entitlement Management

The CIEM tab maps the identity and access structure of a Cloudsmith organisation as a graph. It helps you understand who can access what, and how teams, service accounts, and entitlements are connected.

1. Switch to the **CIEM** tab using the toggle in the left panel
2. Select a workspace — the identity graph loads automatically
3. The graph maps:
   - **Repositories** (square nodes) — what packages are stored and accessible
   - **Members** (circular nodes) — human user accounts
   - **Service Accounts** (circular nodes) — machine/bot identities
   - **Teams** (circular nodes) — groups of members
   - **Entitlements** (circular nodes) — access grants scoped to specific packages or formats
   - **Upstream Proxies** (triangle nodes) — external registries proxied through Cloudsmith

### Node type filtering

Use the left panel to show/hide specific entity types, with live counts per type.

### Searching

Use type prefixes for targeted search:

| Prefix | Matches |
|--------|---------|
| `repo:` | Repositories |
| `user:` | Members |
| `service:` | Service accounts |
| `team:` | Teams |
| `entitlement:` | Entitlements |
| `upstream:` | Upstream proxies |

Or search with free text to match across all types.

### Node details

Click any node to see its role, email, permissions, status, team memberships, and connected relationships grouped by edge type. The detail panel can be dragged and repositioned.

### Reading the graph

- **Solid edges** — structural relationships (org → repo, team → member)
- **Dashed edges** — access and entitlement relationships
- **Shared upstream edges** — highlighted in amber/red to flag repositories that share a common upstream proxy (potential supply chain choke-point)

---

## 7. Generate Vulnerability Reports

1. Click a package node to open its detail panel
2. Click the **Vulnly Report** button (available for scanned packages)
3. A self-contained HTML report opens in a new browser tab with full CVE details, affected/fixed versions, and advisory links

---

## 8. Refresh Data

Click the **Refresh** button (↻) on the graph canvas to force a re-fetch from the Cloudsmith API, bypassing the local cache.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close the attack path modal or detail panel |

---

## Tips

- **Collapse the left panel** to maximise graph space when you don't need filters — the SCA filters are automatically disabled while the Workspace Overview is active
- **Workspace Overview first** — start here to get a risk-ranked view of all repositories before drilling into individual graphs
- **Critical nodes pulse** — look for the animated ring to quickly spot the most urgent issues in the SCA graph
- **Cross-reference SCA + CIEM** — use the SCA tab to find the most vulnerable repositories, then switch to CIEM to see which identities have write or download access to them
- **Format cards** in the repo panel show package counts; click to isolate that format in the graph
- **Most vulnerable** section lists the top-5 riskiest packages — click to navigate directly to that node
