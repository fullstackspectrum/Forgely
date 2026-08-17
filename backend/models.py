from __future__ import annotations

from pydantic import BaseModel


class CVERecord(BaseModel):
    id: str = ""
    severity: str = "Unknown"
    description: str = ""
    url: str = ""
    nvd_url: str = ""
    ghsa_url: str = ""
    affected: str = ""
    affected_version: str = ""
    fixed_in: str = ""


class NodeData(BaseModel):
    version: str = ""
    format: str = ""
    max_severity: str | None = None
    vuln_count: int = 0
    cves: list[CVERecord] = []
    downloads: int = 0
    license: str = ""
    size: int = 0
    scan_status: str = ""
    uploaded_at: str = ""
    slug: str = ""
    pkg_type: str = ""
    is_quarantined: bool = False


class GraphNode(BaseModel):
    id: str
    label: str
    type: str  # "repo", "package", "dependency"
    data: NodeData


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str  # "repo_package", "dependency", "shared_cve"
    label: str = ""


class GraphStats(BaseModel):
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    safe: int = 0
    total_cves: int = 0
    total_nodes: int = 0
    total_edges: int = 0


class GraphResponse(BaseModel):
    owner: str
    repo: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: GraphStats


class WorkspaceCveSummary(BaseModel):
    id: str
    severity: str = "Unknown"
    # Summary-length only, trimmed to OVERVIEW_DESCRIPTION_CHARS with a
    # trailing ellipsis when cut. Full text comes from /api/cve.
    description: str = ""
    packages: list[str] = []


class WorkspaceRepoSummary(BaseModel):
    slug: str
    name: str
    package_count: int = 0
    vuln_count: int = 0
    max_severity: str | None = None
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    safe: int = 0
    cves: list[WorkspaceCveSummary] = []
    formats: dict[str, int] = {}


class WorkspaceOverviewResponse(BaseModel):
    owner: str
    repos: list[WorkspaceRepoSummary]
