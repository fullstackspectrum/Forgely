import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Section {
  title: string;
  items: string[];
}

interface Release {
  version: string;
  date: string;
  sections: Section[];
}

function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  let currentSection: Section | null = null;

  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      if (currentSection && current) current.sections.push(currentSection);
      if (current) releases.push(current);
      currentSection = null;
      const parts = line.slice(3).split(" — ");
      current = { version: parts[0].trim(), date: parts[1]?.trim() ?? "", sections: [] };
    } else if (line.startsWith("### ") && current) {
      if (currentSection) current.sections.push(currentSection);
      currentSection = { title: line.slice(4).trim(), items: [] };
    } else if (line.startsWith("- ") && currentSection) {
      currentSection.items.push(line.slice(2).trim());
    }
  }
  if (currentSection && current) current.sections.push(currentSection);
  if (current) releases.push(current);
  return releases;
}

export default function ChangelogModal({ open, onClose }: Props) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || releases.length > 0) return;
    setLoading(true);
    fetch("/api/changelog")
      .then((r) => r.json())
      .then((data) => setReleases(parseChangelog(data.content)))
      .catch(() => setError("Failed to load changelog."))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content changelog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Changelog</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body changelog-body">
          {loading && <p className="changelog-loading">Loading…</p>}
          {error && <p className="changelog-error">{error}</p>}
          {releases.map((release) => (
            <div key={release.version} className="changelog-release">
              <div className="changelog-release-header">
                <span className="changelog-version">{release.version}</span>
                {release.date && <span className="changelog-date">{release.date}</span>}
              </div>
              {release.sections.map((section) => (
                <div key={section.title} className="changelog-section">
                  <h4 className="changelog-section-title">{section.title}</h4>
                  <ul className="changelog-items">
                    {section.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
