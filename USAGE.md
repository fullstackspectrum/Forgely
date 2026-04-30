# How to Use Forgely

This guide walks you through using Forgely to visualize and explore your Cloudsmith artifact security posture.

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
2. Use the **Repository** dropdown to select a repository (defaults to first alphabetically)
3. Click **Go** — the artifact graph will load and render

---

## 3. Explore the Artifact Graph (Packages Tab)

### Navigation

- **Pan** — click and drag the canvas, or use the directional arrow controls
- **Zoom** — scroll wheel, or use the +/− zoom controls
- **Recenter** — click the recenter button to reset the viewport

### Interacting with Nodes

- **Hover** — nodes glow and enlarge; connected edges stay highlighted while others dim
- **Click** — opens a floating details panel showing package name, version, format, severity, CVEs, and dependencies
- **Drag panel** — the detail panel can be repositioned anywhere on screen

### Filtering

- **Severity filters** — use the left panel to filter by Critical, High, Medium, Low, or show All
- **Status filters** — toggle Vulnerable, Safe, Quarantined, Shared CVEs, Has Dependencies
- **Filter mode** — switch between AND/OR logic for combining multiple status filters
- **Format filter** — click a format card in the repo panel to isolate packages of that type

### Visibility Toggles

- **Shared CVE edges** — show/hide edges connecting packages that share a CVE
- **Dependency nodes** — show/hide dependency relationships
- **Unscanned packages** — show/hide packages without vulnerability data
- **Critical animation** — toggle the pulsing ring effect on Critical-severity nodes

### Layout

Use the layout switcher to change graph arrangement:
- Force-directed (ForceAtlas2)
- Circular
- Radial
- Tree (top-down)
- Horizontal (left-to-right)

### Search

Use the search bar to find packages by name or CVE ID. Matching nodes are highlighted in the graph.

---

## 4. View Attack Paths

1. Click any package node to open its detail panel
2. Click the **Attack Path** button
3. A modal displays the full attack chain: **Client Tools → Internet → Registry → Repository → Package → CVE**
4. Client tools are format-specific (e.g. `docker pull`, `pip install`, `npm install`, `cloudsmith download`, Web UI)

---

## 5. Explore the Organisation Graph (Workspace Tab)

1. Switch to the **Workspace** tab using the toggle in the left panel
2. Select a workspace — the org access graph loads automatically
3. The graph maps: Repositories, Members, Service Accounts, Teams, Entitlements, and Upstream Proxies

### Filtering Org Nodes

Use the node type filters to show/hide specific entity types (Repositories, Members, Services, Teams, Entitlements, Upstreams).

### Searching

Use type prefixes for targeted search:
- `repo:` — repositories
- `user:` — members
- `service:` — service accounts
- `team:` — teams
- `entitlement:` — entitlements
- `upstream:` — upstream proxies

Or search with free text to match across all types.

### Node Details

Click any node to see its role, email, permissions, status, team memberships, and connected relationships grouped by edge type.

---

## 6. Generate Vulnerability Reports

1. Click a package node to open its detail panel
2. Click the **Vulnly Report** button (available for scanned packages)
3. A self-contained HTML report opens in a new browser tab with full CVE details, affected/fixed versions, and advisory links

---

## 7. Refresh Data

Click the **Refresh** button to force a re-fetch from the Cloudsmith API, bypassing the 5-minute cache.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Close the attack path modal or detail panel |

---

## Tips

- **Collapse the left panel** to maximise graph space when you don't need filters
- **Collapse the legend** to reduce visual clutter
- **Critical nodes pulse** — look for the animated ring to quickly spot the most urgent issues
- **Format cards** in the repo panel show package counts; when a severity filter is active, they dim out for formats with no matches
- **Most vulnerable** section lists the top-5 riskiest packages — click to navigate directly to that node
