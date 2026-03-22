# 🌳 Rootly

**Rootly** is a Python-powered visualization engine for Cloudsmith artifact repositories. It maps complex dependency trees into interactive, color-coded graphs to help DevOps and Security teams identify "Blast Radii" and transitive vulnerabilities at a glance.

## ✨ Key Features

- **Deep Trace** – Automatically traverses all Cloudsmith dependency layers with full pagination.
- **Security Heatmap** – Nodes colored Red → Orange → Yellow → Blue → Green by CVE severity.
- **Interactive Physics** – Drag, zoom, filter, and search your artifact web in the browser.
- **Smart Tooltips** – Hover for format, vulnerability count, scan status, and download stats.
- **Legend Overlay** – Built-in severity legend injected into every generated graph.
- **CLI & Env Config** – Pass owner/repo/key via flags or `.env` file — nothing hardcoded.
- **Rate-Limit Aware** – Automatic retries with exponential back-off on 429 responses.
- **Zero-DB** – Fetches directly from the Cloudsmith API — no database required.

## 🚀 Quick Start

### 1. Clone & install

```bash
git clone https://github.com/your-user/rootly.git
cd rootly
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure credentials

```bash
cp .env.example .env
# Edit .env with your Cloudsmith API key, org, and repo
```

Or pass them directly:

```bash
python rootly.py --api-key YOUR_KEY --owner YOUR_ORG --repo YOUR_REPO
```

### 3. Generate the graph

```bash
python rootly.py                          # uses .env values
python rootly.py -o myorg -r myrepo       # override org/repo
python rootly.py --no-deps                # skip dependency fetching (faster)
python rootly.py --output my_graph.html   # custom output filename
```

Open the generated `cloudsmith_security_map.html` in your browser.

## 🎨 Severity Color Key

| Color | Severity | Shape |
|-------|----------|-------|
| 🔴 Red | Critical | ◆ Diamond |
| 🟠 Orange | High | ◆ Diamond |
| 🟡 Yellow | Medium | ● Dot |
| 🔵 Blue | Low | ● Dot |
| 🟢 Green | Safe / None | ● Dot |
| ⚫ Gray | Unscanned / External | ● Dot |

## 📂 Project Structure

```
rootly/
├── rootly.py           # Main application
├── requirements.txt    # Python dependencies
├── .env.example        # Template for credentials
├── .gitignore
├── LICENSE
└── README.md
```

## ⚙️ CLI Reference

| Flag | Env Variable | Description |
|------|-------------|-------------|
| `-o, --owner` | `CLOUDSMITH_OWNER` | Cloudsmith organisation / owner |
| `-r, --repo` | `CLOUDSMITH_REPO` | Repository name |
| `-k, --api-key` | `CLOUDSMITH_API_KEY` | API key for authentication |
| `--output` | — | Output HTML filename (default: `cloudsmith_security_map.html`) |
| `--no-deps` | — | Skip per-package dependency fetching |

## License

See [LICENSE](LICENSE).