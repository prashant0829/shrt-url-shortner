import { useState } from 'react';
import { describeError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useAnalytics } from '../hooks/useAnalytics.js';
import { stripProtocol } from '../lib/format.js';
import { DEFAULT_RANGE, RANGES } from '../lib/ranges.js';
import { BarChart } from './BarChart.jsx';
import { Breakdown } from './Breakdown.jsx';
import { Dialog } from './Dialog.jsx';

const BREAKDOWNS = [
  ['countries', 'Countries'],
  ['browsers', 'Browsers'],
  ['operatingSystems', 'Operating systems'],
  ['devices', 'Devices'],
  ['referrers', 'Referrers'],
];

/**
 * Click analytics for one link.
 * @param {{link: object | null, onClose: () => void}} props `link` of `null` keeps the dialog closed.
 */
export function AnalyticsDialog({ link, onClose }) {
  return (
    <Dialog open={link !== null} onClose={onClose} labelledBy="stats-title" wide>
      {link && <AnalyticsContent link={link} onClose={onClose} />}
    </Dialog>
  );
}

function AnalyticsContent({ link, onClose }) {
  const { api } = useAuth();
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [includeBots, setIncludeBots] = useState(false);
  const { status, data: report, error } = useAnalytics(api, link.code, range, includeBots);

  return (
    <>
      <div className="dialog-head">
        <h2 id="stats-title">Analytics · {stripProtocol(link.shortUrl)}</h2>
        <button className="btn icon" type="button" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="stats-controls">
        <div className="segmented" role="group" aria-label="Time range">
          {Object.entries(RANGES).map(([key, { label }]) => (
            <button
              key={key}
              type="button"
              aria-pressed={range === key}
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={includeBots}
            onChange={(e) => setIncludeBots(e.target.checked)}
          />
          Include bots
        </label>
      </div>

      <div aria-live="polite">
        {status === 'loading' && <p className="muted">Loading…</p>}
        {status === 'error' && (
          <p className="error" role="alert">
            {describeError(error)}
          </p>
        )}
        {status === 'ready' && <Report report={report} />}
      </div>
    </>
  );
}

function Report({ report }) {
  return (
    <>
      <div className="totals">
        <div className="total">
          <strong>{report.totals.clicks.toLocaleString()}</strong>
          Clicks
        </div>
        <div className="total">
          <strong>{report.totals.uniqueVisitors.toLocaleString()}</strong>
          Unique visitors
        </div>
      </div>

      <BarChart series={report.series} interval={report.range.interval} />
      <p className="muted chart-note">
        {report.range.interval === 'day'
          ? 'Days are counted in UTC.'
          : 'Hours are shown in your local time.'}
      </p>

      <div className="breakdowns">
        {BREAKDOWNS.map(([key, title]) => (
          <Breakdown key={key} title={title} entries={report.breakdowns[key]} />
        ))}
      </div>
    </>
  );
}
