

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/forgely-lockup-reversed.svg">
  <img src="assets/readme/forgely-lockup.svg" alt="Forgely" width="280">
</picture>

**From artifact to blast radius.**

---

> [!CAUTION]
> This project is an independent, community-developed tool and is **not** affiliated with, endorsed by, or supported by Cloudsmith Ltd. It is provided "as is", without warranty of any kind. Cloudsmith Ltd. accepts no responsibility or liability for any loss, damage, or issues arising from the use of this tool. Use at your own risk.

**Forgely** is a security graph visualization engine for Cloudsmith artifact repositories. It covers two core cloud-native security disciplines — **SCA** and **CIEM** — surfacing them as interactive, colour-coded graphs so DevOps and Security teams can identify blast radii, transitive risks, and access exposure at a glance.


Workspace overview
![Example – Workspace Overview](assets/readme/example_workspace_graph.jpg)


Repository graph
![Example – Repo graph](assets/readme/example_repo_graph.jpg)

Repository graph details
![Example – Repo details](assets/readme/example_repo_graph_details.jpg)

Package details
![Example – Package details](assets/readme/example2.jpg)

Package Attack Path
![Example – Attack Path](assets/readme/example3.jpg)

Dependancy tracking
![Example – Dependancies](assets/readme/example4.jpg)

CIEM graph
![Example – CIEM Graph](assets/readme/ciem-graph.jpg)

CIEM user
![Example – CIEM user](assets/readme/ciem-user.jpg)

CIEM attack path
![Example – CIEM attack path](assets/readme/ciem-attack-path.jpg)

---

## Security Domains

### SCA — Software Composition Analysis

SCA is the practice of scanning open-source and third-party package dependencies for known vulnerabilities (CVEs). It is a foundational pillar of software supply chain security.

Forgely's SCA view answers:
- Which packages across my repositories contain known CVEs?
- What is the blast radius of a specific vulnerability — which dependent packages are transitively exposed?
- Which packages are quarantined, and why?
- What does the full attack path look like from a client tool to a CVE?

### CIEM — Cloud Infrastructure Entitlement Management

CIEM focuses on governing *who has access to what* in cloud and SaaS environments. Excessive or misconfigured entitlements are a leading cause of cloud security incidents.

Forgely's CIEM view answers:
- Which members, service accounts, and teams have access to which repositories?
- What entitlements and upstream proxies are in use?
- Are there unexpected or over-privileged access paths between identities and resources?
- How are teams structured, and what do their combined access rights look like?

### Together

| Domain | What it protects | Key question |
|--------|-----------------|--------------|
| **SCA** | Software supply chain | What vulnerable components am I running? |
| **CIEM** | Identity & access surface | Who can reach those components — and should they? |

Combining SCA and CIEM in a single tool means you can cross-reference a vulnerable package with the identities that have write or download access to the repository that hosts it — a critical step in assessing actual exploitability and impact.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  React + Vite  ──  Sigma.js (WebGL)  ──  graphology     │
└────────────────────────┬────────────────────────────────┘
                         │ /api/*
┌────────────────────────▼────────────────────────────────┐
│  FastAPI  (localhost:8000)                              │
│  In-memory cache · ThreadPoolExecutor (20 workers)      │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────┐
│  Cloudsmith API  (api.cloudsmith.io/v1)                 │
└─────────────────────────────────────────────────────────┘
```

| Layer | Stack |
|-------|-------|
| **Frontend** | React 18, TypeScript, Vite, Sigma.js v3 (WebGL), graphology, ForceAtlas2 |
| **Backend** | Python 3.10+, FastAPI, uvicorn, requests, vulnly |
| **Graph rendering** | Sigma.js with custom node programs: images, squares, hexagons, rings |
| **Data source** | Cloudsmith REST API v1 |

---

## Key Features

### SCA — Software Composition Analysis

- **WebGL rendering** via Sigma.js — smooth 60fps pan/zoom, GPU-accelerated, handles thousands of nodes
- **Severity-coded nodes** — Critical / High / Medium / Low / Safe / Unscanned, each with a distinct colour
- **Pulsing critical nodes** — animated ring effect on Critical packages to draw immediate attention (toggleable)
- **Hover effects** — node glow + size boost; un-hovered edges dim out; connected nodes stay highlighted
- **Quarantine indicators** — quarantined packages rendered with a distinct ring node program
- **Floating details panel** — click any node to open a draggable, repositionable panel; expand to full screen for deep inspection
- **CVE detail cards** — per-CVE severity badge, affected/fixed versions, NVD and GitHub Advisory links; paginated with search and severity filter
- **Format cards** — repo overview panel shows package formats with total counts; format cards dim when a severity filter is active
- **Most vulnerable** — top-5 most vulnerable packages listed in the repo panel, clickable to navigate directly to that node
- **Dependency graph** — expandable dependencies list within the package panel; click to refocus on a dependency node
- **Attack path panel** — visualises the full attack chain: Client Tools → Internet → Registry → Repository → Package → CVE, with format-specific client tool examples
- **CVE search** — search by CVE ID or package name; matching nodes are highlighted in the graph
- **Severity filters** — All / Vulnerable / Safe / Critical / High / Medium / Low / Quarantined / Shared CVEs / Has Dependencies
- **Visibility toggles** — show/hide: shared CVE edges, dependency nodes, unscanned packages, critical animation
- **Format filter** — click a format card in the repo panel to isolate packages of that format in the graph
- **Workspace overview** — cross-repository SCA view: all repos in an organisation rendered as a single graph, with aggregate vulnerability stats, package format heatmap, severity breakdown, and cross-repo CVE search
- **Layout switcher** — Force-directed (ForceAtlas2), Circular, Radial, Tree, Horizontal; edge style auto-switches to match layout
- **Refresh** — force re-fetch bypasses the cache and pulls fresh data from Cloudsmith

### CIEM — Cloud Infrastructure Entitlement Management

- **Identity graph** — maps repositories, members, service accounts, teams, entitlements, and upstream proxies as an interconnected graph
- **Node type filtering** — filter by Repositories, Members, Services, Teams, Entitlements, or Upstreams with live counts
- **Prefixed search** — search with type prefixes (`repo:`, `user:`, `service:`, `team:`, `entitlement:`, `upstream:`) or free text
- **Node detail panel** — click any node to see role, email, permissions, status, team memberships, and all connected relationships grouped by edge type
- **Access path visibility** — entitlement and access edges are rendered as dashed curves to distinguish them from structural relationships

### General

- **Vulnly reports** — generate self-contained HTML vulnerability reports for any scanned package via [vulnly](https://pypi.org/project/vulnly/), opened in a new tab
- **Workspace selector** — switch between Cloudsmith organisations; repository selector with per-namespace package counts
- **API key management** — connect/disconnect via in-app modal; key validated against the Cloudsmith API before saving
- **Panel collapse** — left control panel can be fully collapsed for more graph space
- **Version string** — panel header shows truncated version with full tooltip and one-click copy to clipboard
- **Dark security-product theme** — graph-paper grid background, glassmorphism toolbars, custom scrollbars

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.10+** — [python.org](https://www.python.org/downloads/)
- **Node.js 18+** and **npm** — [nodejs.org](https://nodejs.org/)
- A **Cloudsmith API key** — [Generate one here](https://app.cloudsmith.com/user/settings/api/)

### 1. Clone

```bash
git clone https://github.com/your-user/Forgely.git
cd Forgely
```

### 2. Run

```bash
./start.sh
```

The start script creates the Python virtual environment, installs all dependencies, and launches both servers:

- Backend → **http://localhost:8000**
- Frontend → **http://localhost:3000**

Press `Ctrl+C` to stop both servers.

<details>
<summary>Manual start</summary>

```bash
# Terminal 1 — Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --port 8000

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev
```

</details>

---

## ⚙️ Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDSMITH_API_KEY` | Yes* | Cloudsmith API key (*can also be set via the in-app Connect modal) |
| `CLOUDSMITH_OWNER` | No | Default organisation slug (pre-populates the workspace selector) |
| `CLOUDSMITH_REPO` | No | Default repository slug (pre-populates the repo selector) |
| `CORS_ORIGINS` | No | Comma-separated allowed CORS origins (default: `http://localhost:3000`) |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/config` | GET | Returns configured owner, repo, and key status |
| `/api/namespaces` | GET | List Cloudsmith workspaces the key has access to |
| `/api/repos/{owner}` | GET | List repositories for a workspace |
| `/api/graph` | GET | SCA artifact graph for `?owner=&repo=` (5 min cache) |
| `/api/graph/refresh` | POST | Force re-fetch, bypassing cache |
| `/api/search` | GET | Search packages by name/version/format |
| `/api/workspace-overview` | GET | Cross-repo SCA overview for `?owner=` (10 min cache) |
| `/api/org-graph` | GET | CIEM identity graph for `?owner=` |
| `/api/auth/validate` | POST | Validate a Cloudsmith API key |
| `/api/vulnly-report/{owner}/{repo}/{slug}` | GET | Generate HTML vulnerability report via [vulnly](https://pypi.org/project/vulnly/) |

---

## Reading the graph

The graph uses the same vocabulary as the mark: a grid of rounded squares
around one displaced ember cell.

| Node | Meaning |
|------|---------|
| Ember square, tilted | The repository — the centre everything is arranged around |
| Blue square | A package. The shade is its distance from whatever you have selected |
| Blue square, tilted | The package you are currently investigating |
| Hexagon | A dependency |

**Fill encodes distance, not severity.** Selecting a package shades the graph by
how far each node is from it — direct, two hops, three, then everything beyond.
Containment edges are not traversed: reaching another package *through* the
repository is not blast radius. Nodes it cannot reach fade back rather than
changing colour, so the distance encoding survives the dimming.

**Severity is a ring, and never colour alone.** Each level also has a distinct
width and shape so it survives a greyscale screenshot — the ramp itself does
not: desaturated, Critical and Low land three levels apart out of 255.

| Level | Mark | Ring | Light | Dark |
|-------|------|------|-------|------|
| Critical | ● filled circle | 6px | `#D62B20` | `#FF3B30` |
| High | ▲ filled triangle | 4px | `#C25E00` | `#FF8A1F` |
| Medium | ■ filled square | 2.5px | `#8A6410` | `#F2CE3F` |
| Low | ○ hollow circle | 1.5px | `#4E657D` | `#7FA8C9` |
| None | □ hollow square | none | — | — |

Graph rings are more saturated than the severity colours used in text and
badges: a ring is a non-text element, so it is held to 3:1 rather than 4.5:1
and can be far better separated. Text severities use the muted ramp.

Both themes are supported — Light, Auto and Dark, in the sidebar footer. Auto
follows the system setting.

---

## 🗺️ Layout Modes

| Layout | Description |
|--------|-------------|
| 💥 Force | ForceAtlas2 — organic clustering by connection gravity |
| ◎ Circular | All nodes arranged in a circle |
| 🎯 Radial | Repository / workspace pinned to centre, nodes orbit outward |
| 🌳 Tree | Hierarchical top-down |
| ↔ Horizontal | Left-to-right tree layout |

---

## 📂 Project Structure

```
Forgely/
├── backend/
│   ├── main.py               # FastAPI app, graph construction, caching
│   ├── cloudsmith.py         # Cloudsmith API client (packages, vulns, deps, org)
│   ├── models.py             # Pydantic response models
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── public/               # Brand SVGs and self-hosted fonts
│   └── src/
│       ├── components/
│       │   ├── GraphCanvas.tsx              # SCA artifact graph (Sigma.js WebGL)
│       │   ├── OrgGraphCanvas.tsx           # CIEM identity graph (Sigma.js WebGL)
│       │   ├── WorkspaceOverviewCanvas.tsx  # Cross-repo SCA overview graph
│       │   ├── SidePanel.tsx                # Package / repo / dependency detail panel
│       │   ├── OrgSidePanel.tsx             # CIEM node detail panel
│       │   ├── WorkspaceOverviewPanel.tsx   # Workspace-level SCA summary panel
│       │   ├── WorkspaceRepoPanel.tsx       # Per-repo SCA detail panel (overview mode)
│       │   ├── AttackGraphPanel.tsx         # Attack path visualisation
│       │   ├── FilterBar.tsx                # Left control panel (SCA tab)
│       │   ├── OrgLeftPanel.tsx             # Left control panel (CIEM tab)
│       │   ├── LayoutPopout.tsx             # Shared layout/edge style control
│       │   ├── SearchBar.tsx                # Package / CVE search
│       │   ├── OrgSearchBar.tsx             # CIEM node search
│       │   ├── RepoSelector.tsx             # Workspace + repository selector
│       │   ├── WorkspaceSelector.tsx        # Organisation selector
│       │   ├── Legend.tsx                   # SCA graph legend
│       │   ├── OrgLegend.tsx                # CIEM graph legend
│       │   ├── ConnectModal.tsx             # API key connect/disconnect modal
│       │   ├── SeverityMark.tsx             # Severity as shape + colour, never colour alone
│       │   ├── ThemeToggle.tsx              # Light / Auto / Dark
│       │   └── LoadingIndicator.tsx         # Branded loader with real build progress
│       ├── hooks/
│       │   ├── useGraphData.ts        # Streams the SCA graph, with progress
│       │   └── useCveDescriptions.ts  # CVE descriptions, fetched on expand
│       ├── lib/
│       │   ├── auth.ts                # API key storage and fetch wrapper
│       │   ├── palette.ts             # Design tokens for canvas/WebGL code
│       │   ├── theme.ts               # Light / Auto / Dark selection
│       │   ├── layout.ts              # ForceAtlas2 placement and settling
│       │   ├── hoverRenderer.ts       # Canvas hover card and node labels
│       │   └── formatIcons.ts         # Package format → icon, used by panels
│       ├── programs/
│       │   ├── roundedSquare.ts       # Node shapes from the mark, with severity rings
│       │   ├── NodeHexagonProgram.ts  # Dependency nodes
│       │   └── NodeRingProgram.ts     # Pulse rings on Critical packages
│       ├── styles/
│       │   ├── tokens.css             # Design tokens (light + dark)
│       │   └── fonts.css              # Self-hosted Inter / Space Grotesk / JetBrains Mono
│       ├── types/
│       │   └── index.ts               # TypeScript types and constants
│       ├── App.tsx                    # Root component, tab routing, panel state
│       ├── main.tsx                   # Entry point
│       └── index.css                  # Global styles
│   ├── package.json
│   └── vite.config.ts
├── .claude/
│   └── commands/
│       └── commit-msg.md             # /commit-msg Claude Code skill
├── start.sh                          # Start script (backend + frontend)
├── .env                              # Credentials (not committed)
├── assets/
│   ├── brand/                        # Brand SVGs and the design tokens
│   ├── img/
│   └── readme/                       # README screenshots and brand lockups
├── CHANGELOG.md
├── LICENSE
└── README.md
```

---

## License

See [LICENSE](LICENSE).
