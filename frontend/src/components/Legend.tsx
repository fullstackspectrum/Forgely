export default function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Artigraphly</div>
      <div className="legend-items">
        <span>
          <i className="dot" style={{ background: "#000000" }} /> Repository
        </span>
        <span>
          <i className="dot" style={{ background: "#28a745" }} /> Package (Safe)
        </span>
        <span>
          <i className="dot" style={{ background: "#ffffff", border: "1px solid #888" }} /> Package (Not Scanned)
        </span>
        <span>
          <i className="dot-hexagon" style={{ background: "#9b59b6" }} /> Dependency
        </span>
      </div>
      <div className="legend-edges">
        <span>
          <span className="edge-line shared" /> Shared CVE
        </span>
        <span>
          <span className="edge-line dep" /> Dependency
        </span>
      </div>
    </div>
  );
}
