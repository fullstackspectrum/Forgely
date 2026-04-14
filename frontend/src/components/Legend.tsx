export default function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Artigraphly</div>
      <div className="legend-items">
        <span>
                    <i className="dot" style={{ background: "#000000" }} /> Repository
        </span>
        <span>
          <i className="dot" style={{ background: "#ff4d4d" }} /> Critical
        </span>
        <span>
          <i className="dot" style={{ background: "#ff8c1a" }} /> High
        </span>
        <span>
          <i className="dot" style={{ background: "#ffd11a" }} /> Medium
        </span>
        <span>
          <i className="dot" style={{ background: "#79b8ff" }} /> Low
        </span>
        <span>
          <i className="dot" style={{ background: "#28a745" }} /> Safe
        </span>
        <span>
          <i className="dot" style={{ background: "#666666" }} /> Not Scanned
        </span>
        <span>
          <i className="dot" style={{ background: "#9b59b6" }} /> Dependency
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
