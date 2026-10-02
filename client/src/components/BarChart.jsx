import { bucketLabel, pluralize } from '../lib/format.js';

const WIDTH = 640;
const HEIGHT = 170;
const PAD = { top: 8, right: 8, bottom: 22, left: 34 };

/**
 * Clicks per time bucket as an SVG bar chart (no chart library needed for one chart).
 *
 * @param {object} props
 * @param {{bucket: string, clicks: number}[]} props.series
 * @param {'hour' | 'day'} props.interval
 */
export function BarChart({ series, interval }) {
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(1, ...series.map((point) => point.clicks));
  const step = innerWidth / Math.max(1, series.length);
  const total = series.reduce((sum, point) => sum + point.clicks, 0);
  const baseline = PAD.top + innerHeight;
  const first = series[0];
  const last = series.at(-1);

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${pluralize(total, 'click')} over ${series.length} ${interval === 'hour' ? 'hours' : 'days'}`}
    >
      <line x1={PAD.left} x2={WIDTH - PAD.right} y1={baseline} y2={baseline} />
      <text x={PAD.left - 6} y={PAD.top + 8} textAnchor="end">
        {max}
      </text>
      <text x={PAD.left - 6} y={baseline} textAnchor="end">
        0
      </text>

      {series.map((point, index) => {
        const barHeight = (point.clicks / max) * innerHeight;
        return (
          <rect
            key={point.bucket}
            className="bar"
            x={PAD.left + index * step + step * 0.14}
            y={baseline - barHeight}
            width={Math.max(1, step * 0.72)}
            height={Math.max(point.clicks > 0 ? 1 : 0, barHeight)}
            rx={2}
          >
            <title>{`${bucketLabel(point.bucket, interval)}: ${pluralize(point.clicks, 'click')}`}</title>
          </rect>
        );
      })}

      {first && last && (
        <>
          <text x={PAD.left} y={HEIGHT - 6}>
            {bucketLabel(first.bucket, interval)}
          </text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end">
            {bucketLabel(last.bucket, interval)}
          </text>
        </>
      )}
    </svg>
  );
}
