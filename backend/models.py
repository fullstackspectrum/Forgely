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


class PackageDetail(BaseModel):
    """Everything the details panel shows that the graph does not carry.

    Served on selection rather than inlined on every node: the graph already
    ships 7,500 packages for neuro-packages, and none of this is visible until
    one of them is clicked. Same arrangement as CVE descriptions.

    Most fields vary by format — a Docker image has a platform, an Alpine
    package has a distro and an architecture, a Conda package has a build
    string — so `identifiers` and `tags` are passed through as the API returns
    them rather than flattened into a fixed shape.
    """

    slug: str = ""
    name: str = ""
    version: str = ""
    format: str = ""
    filename: str = ""
    extension: str = ""
    description: str = ""
    summary: str = ""

    # Provenance
    uploader: str = ""
    uploaded_at: str = ""
    repository: str = ""
    namespace: str = ""

    # Content
    size: int = 0
    num_files: int = 0
    downloads: int = 0
    license: str = ""
    spdx_license: str = ""

    # Digests, strongest first in the UI.
    checksum_md5: str = ""
    checksum_sha1: str = ""
    checksum_sha256: str = ""
    checksum_sha512: str = ""

    # Format-specific. Values are stringified so a panel never has to guess at
    # a nested shape it has not seen; tags keep their category grouping.
    identifiers: dict[str, str] = {}
    tags: dict[str, list[str]] = {}
    architectures: list[str] = []
    distro: str = ""
    subtype: str = ""
    type_display: str = ""
    epoch: str = ""
    release: str = ""

    # State
    status: str = ""
    stage: str = ""
    scan_status: str = ""
    is_quarantined: bool = False
    is_malware_detected: bool = False
    policy_violated: bool = False

    # Links
    web_url: str = ""
    cdn_url: str = ""
    signature_url: str = ""
