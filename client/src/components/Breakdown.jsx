// A ranked list with proportional bars, such as the top countries.
export function Breakdown({ title, entries }) {
  const top = Math.max(1, ...entries.map((entry) => entry.clicks));

  return (
    <section>
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="muted">No data yet</p>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.label}
            className="bd-row"
            style={{ '--pct': `${Math.round((entry.clicks / top) * 100)}%` }}
          >
            <span title={entry.label}>{entry.label}</span>
            <span>{entry.clicks.toLocaleString()}</span>
          </div>
        ))
      )}
    </section>
  );
}
