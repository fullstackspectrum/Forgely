# How to Use Forgely

Forgely covers two cloud-native security disciplines in a single tool:

| Tab | Domain | What it shows |
|-----|--------|---------------|
| **SCA** | Software Composition Analysis | Package vulnerabilities, CVEs, blast radii, attack paths |
| **CIEM** | Cloud Infrastructure Entitlement Management | Identity relationships, access entitlements, team structure |

Switch between them with the **📦 SCA** / **🔐 CIEM** tabs at the top of the left panel.

---

## 1. Launch and Connect

**Container** — `docker run -d -p 8000:8000 -v forgely-cache:/data fullstackspectrum/forgely:latest`, then open **http://localhost:8000**.

**From source** — `./start.sh`, then open **http://localhost:3000** (Vite serves the frontend and proxies `/api` to the backend on :8000).

Then add your key:

1. Click **Settings** (⚙) at the bottom of the left panel
2. Open the **Connection** tab
3. Paste your Cloudsmith API key — [generate one here](https://app.cloudsmith.com/user/settings/api/)
4. Click **Connect**. The key is validated against the Cloudsmith API before it is saved, and stored in your browser — never in the image
5. Once connected, the workspace dropdown populates with your organisations

The Connection tab shows which user the stored key belongs to, and carries the **Switch** and **Disconnect** actions. A server-side `CLOUDSMITH_API_KEY` environment variable works too, if you would rather every visitor to an instance share one key.

---

## 2. Select a Workspace and Repository

1. Use the **Workspace** dropdown in the top bar to select your Cloudsmith organisation
2. Use the **Repository** dropdown to select a repository — each entry shows its package count
3. Click **Go** — the SCA artifact graph loads and renders
4. Or click **Workspace Overview** for a cross-repository view of the whole organisation

---

## 3. SCA — Software Composition Analysis

The SCA tab visualises the vulnerability posture of a single repository as an interactive graph. Nodes are packages, version groups and dependencies; edges are containment, dependency and shared-CVE relationships.

### Reading the graph

- **Fill encodes distance from your selection**, not severity — direct, two hops, three, then everything beyond. Containment edges are not traversed, because reaching another package *through* the repository is not blast radius
- **Severity is the ring** around a node: Critical, High, Medium, Low, in one width for every level
- **Shape carries identity** — tilted ember square for the repository, blue square for a package, hexagon for a dependency, and `name (n)` for a version group

### Navigation

- **Pan** — click and drag the canvas, or use the directional arrow controls
- **Zoom** — scroll wheel, or the +/− controls
- **Fit graph** — centres on the repository and zooms out until every node is on screen
- **Refresh** (↻) — force a re-fetch from Cloudsmith, bypassing the cache

### Interacting with nodes

- **Hover** — the node glows and grows; connected nodes stay lit while the rest dim
- **Click** — opens the details panel docked to the right of the canvas. The graph and top bar make room for it rather than being covered; the ⤢ control expands it to full screen, where long CVE and dependency lists reflow into columns
- **Right-click a Critical or High package** — quick action to open its attack path
- **Click the background** — clears the selection

### Version groups

Packages sharing a name collapse into one node carrying the group's worst severity — on a container repository that is 292 nodes down to 15.

- **Click a group** — opens the group panel, listing every version worst-first with severity, type, architecture and tags. Searchable by tag, which is what you want for Docker, where the version is a digest and the tag is the only readable part
- **Double-click a group** — expands it in the graph into its individual versions
- **Double-click the background** — collapses every open group again
- **Expand all / collapse all** — from the graph controls

### Panel tabs

A package splits across four tabs:

| Tab | Contents |
|-----|----------|
| **Details** | Version, format, digests (click to copy), identifiers, tags, uploader, filename, architecture, distribution |
| **Vulnerabilities** | Per-CVE cards with severity, affected and fixed versions, NVD and GitHub Advisory links — paginated, with search and a severity filter |
| **Dependencies** | Transitive dependencies; click one to refocus the graph on it. Shown only when the format reports dependency data |
| **Reachability** | Who can reach the repository holding this artifact — the SCA/CIEM join. Loads with its own spinner, so a slow access lookup never holds up the vulnerability data |

### Filtering

- **Severity** — Critical / High / Medium / Low, multi-select: pick Critical *and* High to see both. No selection means every severity
- **Status** — Vulnerable, Safe, Quarantined, Malware, Shared CVEs, Has dependencies
- **Filter mode** — AND or OR when two or more status filters are active
- **Format filter** — click a format card in the repo panel to isolate that format

"Safe" means *scanned and clean*, not merely "no findings recorded", so packages whose format Cloudsmith cannot scan are excluded rather than counted as healthy.

### Visibility toggles

In **Settings → General**:

- **Shared CVE edges** — edges between packages carrying the same CVE
- **Dependencies** — transitive packages pulled in indirectly
- **Unsupported scans** — packages in formats Cloudsmith does not scan
- **Critical animation** — pulsing rings around Critical packages
- **Malware animation** — the same treatment for packages flagged as malware
- **Edge style** — straight or curved

### Layout

| Layout | Description |
|--------|-------------|
| Force | ForceAtlas2 — organic clustering by connection gravity |
| Circular | All nodes in a circle |
| Radial | Repository at centre, packages orbit outward |
| Tree | Hierarchical top-down |
| Horizontal | Left-to-right tree |

Edge style follows the layout automatically.

### Search

Search by package name or CVE ID. Selecting a result keeps that node and its neighbours visible rather than filtering them away, so an active filter never hides the thing you just looked up.

---

## 4. SCA — Workspace Overview

An organisation-wide summary without loading individual repository graphs.

1. Select a workspace in the top bar
2. Click **Workspace Overview** — every repository is fetched and scanned in parallel
3. Each repository is a node; the central node is the workspace
4. Node size reflects package count; node colour reflects the highest-severity finding

### Canvas interactions

- **Click a repo node** — opens the repo detail panel and focuses the view on it
- **Click the central node** — opens the workspace summary panel
- **Right-click a repo node** — **Load Full Graph**, to drill into that repository
- **Click the background** — deselects and restores all nodes

### Workspace summary panel

- Total packages, vulnerabilities and unique CVEs across all repositories
- Severity breakdown bar
- Package format heatmap across the workspace
- Repo list sorted by vulnerability count — click a row to open its detail panel
- Search: type a CVE ID, package name or repo name to find which repositories are affected; results are repo-centric, showing matched CVEs and packages per repo
- Connected repositories are drawn as a distinct directional edge and listed in the repository panel

### Repo detail panel

- Per-repository vulnerability stats and severity bar
- CVE list paginated at 10 (collapsed) or 35 (expanded)
- Severity filter pills and text search by CVE ID or package name
- **Load Full Graph** — drills into that repository's SCA graph

---

## 5. View Attack Paths

1. Click a package node, or right-click a Critical or High one
2. Click **Attack Path**
3. A modal shows the full chain: **Client Tools → Internet → Registry → Repository → Package → CVE**
4. Client tools are format-specific (`docker pull`, `pip install`, `npm install`, `cloudsmith download`, Web UI)

Press `Escape` to close it.

---

## 6. CIEM — Cloud Infrastructure Entitlement Management

The CIEM tab maps the identity and access structure of a Cloudsmith organisation as a graph: who can access what, and how teams, service accounts and entitlements connect.

1. Switch to the **🔐 CIEM** tab in the left panel
2. Select a workspace — the identity graph loads automatically

| Entity | Shape |
|--------|-------|
| Workspace | Tilted ember square at the centre |
| Repositories | Square |
| Entitlements | Square, much smaller — a grant on a repo is the same family with less weight |
| Members | Circle |
| Teams | Circle, larger than the members in them |
| Service accounts | Triangle |
| Upstream proxies | Hexagon |

### Node type filtering

Show or hide each entity type from the left panel, with live counts per type.

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

Or free text to match across all types.

### Node details

Click any node for its role, email, permissions, status, team memberships and every connected relationship, grouped by edge type.

### Reading the graph

- **Solid edges** — structural relationships (workspace → repo, team → member)
- **Dashed curves** — access and entitlement relationships, so permission paths read differently from structural ones
- **Shared upstream edges** — link repositories that proxy the same external registry, flagging a common supply chain choke-point
- **Connected repository edges** — Cloudsmith's own repository connections, drawn directionally

---

## 7. Crossing Between SCA and CIEM

- The package panel's **Reachability** tab answers *who can reach this artifact* without leaving the graph
- **Jump to CIEM** opens the identity graph focused on the repository hosting that package
- Access is fetched per repository rather than per package, so clicking between packages in one repo costs a single request

The usual workflow: find the most vulnerable repositories in SCA, then check in CIEM which identities have write or download access to them.

---

## 8. Generate Vulnerability Reports

Reports are self-contained HTML files — no network access needed to read them — built from Cloudsmith's OSV advisory data and themed to match the app.

- **Per package** — click a package node, then **Vulnly Report**. Available for any scanned package, including clean ones
- **Per repository** — the **Repo Summary** report from the repository panel, or from a repo in the Workspace Overview

The file downloads to your browser's downloads folder; open it in any browser.

---

## 9. Themes

Light, Auto and Dark, from the footer of the left panel. Auto follows your system setting. Reports pick up whichever theme is active when you generate them.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close the attack path modal, the settings dialog, or an open search / selector dropdown |

---

## Tips

- **Workspace Overview first** — get a risk-ranked view of every repository before drilling into one
- **Collapse the left panel** for maximum graph space — SCA filters are disabled while the Workspace Overview is active anyway
- **Critical nodes pulse** — the animated ring is the fastest way to spot what is urgent
- **Group by version** keeps a Docker repository readable; search the group panel by tag, since the version is a digest
- **Format cards** in the repo panel show package counts; click one to isolate that format
- **Most vulnerable** lists the top-5 riskiest packages — click to jump straight to that node
- **Mount `/data`** when running the container: the scan cache is keyed on each package's scan completion time, so a warm cache turns a cold build of several thousand packages into a local read
