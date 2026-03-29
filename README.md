

![Artigraphly](assets/readme/artigraphly-logo-banner.png)

---



**Artigraphly** is a visualization engine for Cloudsmith artifact repositories. It maps packages, dependencies, and vulnerabilities into interactive, color-coded graphs — helping DevOps and Security teams identify blast radii and transitive risks at a glance.

![Example – Tree Layout](assets/readme/example1.png)

![Example – Force Layout](assets/readme/example2.png)

## Architecture

- **Backend** (`backend/`) — FastAPI server that fetches Cloudsmith data and serves it as a JSON API (`/api/graph`, `/api/config`, `/api/health`), with in-memory caching (5 min TTL)
- **Frontend** (`frontend/`) — React + Vite app using [Sigma.js](https://www.sigmajs.org/) (WebGL) for graph rendering via [graphology](https://graphology.github.io/)

## Key Features

- **WebGL rendering** via Sigma.js — smooth 60fps pan/zoom, GPU-accelerated, handles thousands of nodes
- **Edge bundling** — curved edges via `@sigma/edge-curve`, with varying curvature for shared-CVE vs dependency edges
- **Hover glow effects** — node highlighting + size boost on hover via Sigma reducers; un-hovered edges dim out
- **Side panel** — click any node to get a polished detail panel (animated slide-in) with metadata grid, CVE cards with severity badges, advisory links, and shared-CVE cross-references
- **CVE search** — search bar with exact and substring matching, highlights affected nodes
- **Severity filters** — All / Vulnerable / Safe / Critical / High / Medium / Low
- **Layout switcher** — Force-directed (ForceAtlas2), Circular, Radial
- **Refresh button** — force re-fetch from Cloudsmith API
- **Dark security-product theme** — graph-paper grid background, glassmorphism toolbars, custom scrollbars

## 🚀 Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-user/Artigraphly.git
cd Artigraphly
```

**Backend:**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

**Frontend:**

```bash
cd frontend
npm install
```

### 2. Configure credentials

```bash
cp .env.example .env
# Edit .env with your Cloudsmith API key, org, and repo
```

### 3. Run

```bash
# Terminal 1 — Backend
cd backend && .venv/bin/uvicorn main:app --port 8000

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open **http://localhost:3000** in your browser.

## 🎨 Severity Color Key

| Color | Severity | Description |
|-------|----------|-------------|
| 🔴 `#ff4d4d` | Critical | Critical vulnerabilities |
| 🟠 `#ff8c1a` | High | High severity |
| 🟡 `#ffd11a` | Medium | Medium severity |
| 🔵 `#79b8ff` | Low | Low severity |
| 🟢 `#28a745` | Safe | No vulnerabilities detected |
| ⚫ `#666666` | Unscanned | External / unscanned dependency |
| 🟣 `#9b59b6` | Grouped | Clustered package (multiple versions) |

## 🗺️ Layout Modes

| Layout | Description |
|--------|-------------|
| 🌲 Tree | Hierarchical top-down — repo at top, packages below, deps at bottom |
| 💥 Force | Force-directed — organic clustering by gravity |
| ◎ Radial | Repo pinned to center, packages orbit around it |
| → Horizontal | Left-to-right tree layout |
| ⬡ Cluster | Repulsion-based — nodes group by connectivity |

## 📂 Project Structure

```
Artigraphly/
├── backend/
│   ├── main.py               # FastAPI application
│   ├── cloudsmith.py          # Cloudsmith API client
│   ├── models.py              # Pydantic response models
│   └── requirements.txt       # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── components/        # React components (GraphCanvas, SidePanel, FilterBar, etc.)
│   │   ├── hooks/             # Custom hooks (useGraphData)
│   │   ├── types/             # TypeScript type definitions
│   │   ├── App.tsx            # Root component
│   │   ├── main.tsx           # Entry point
│   │   └── index.css          # Global styles
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── artigraphly.py             # Legacy CLI tool
├── .env                       # Credentials (not committed)
├── assets/
│   └── cloudsmith.png
├── LICENSE
└── README.md
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/config` | GET | Returns configured owner and repo |
| `/api/graph` | GET | Fetch graph data (cached for 5 min) |
| `/api/graph/refresh` | POST | Force re-fetch from Cloudsmith |

## ⚙️ Configuration

Set the following in your `.env` file:

| Variable | Description |
|----------|-------------|
| `CLOUDSMITH_API_KEY` | Cloudsmith API key |
| `CLOUDSMITH_OWNER` | Cloudsmith organisation / owner |
| `CLOUDSMITH_REPO` | Repository name |


## License

See [LICENSE](LICENSE).