import type { Theme } from "../lib/theme";

const OPTIONS: { key: Theme; label: string; title: string }[] = [
  { key: "light", label: "Light", title: "Always light" },
  { key: "system", label: "Auto", title: "Follow the system setting" },
  { key: "dark", label: "Dark", title: "Always dark" },
];

interface Props {
  theme: Theme;
  onChange: (t: Theme) => void;
}

/**
 * Light / Auto / Dark.
 *
 * Three states rather than a two-way switch: "auto" has to be distinct from
 * whichever theme it currently resolves to, or a user who picks light on a
 * dark-set machine gets flipped back the next time the OS changes.
 */
export default function ThemeToggle({ theme, onChange }: Props) {
  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={theme === o.key}
          className={`theme-toggle-btn${theme === o.key ? " active" : ""}`}
          title={o.title}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
