# 🌳 Rootly

**Rootly** is a Python-powered visualization engine for Cloudsmith artifact repositories. It maps complex dependency trees into interactive, color-coded graphs to help DevOps and Security teams identify "Blast Radii" and transitive vulnerabilities at a glance.

## ✨ Key Features
* **Deep Trace:** Automatically traverses Cloudsmith dependency layers.
* **Security Heatmap:** Nodes turn Red/Orange based on real-time CVE severity.
* **Interactive Physics:** Drag, zoom, and filter your artifact web in the browser.
* **Zero-DB:** Fetches directly from the Cloudsmith API—no database required.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pip install requests pyvis networkx