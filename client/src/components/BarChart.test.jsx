import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BarChart } from './BarChart.jsx';

const day = (n) => new Date(Date.UTC(2026, 8, n)).toISOString();

describe('BarChart', () => {
  const series = [
    { bucket: day(1), clicks: 0 },
    { bucket: day(2), clicks: 5 },
    { bucket: day(3), clicks: 10 },
  ];

  it('draws one bar per bucket, scaled to the busiest one', () => {
    const { container } = render(<BarChart series={series} interval="day" />);
    const heights = [...container.querySelectorAll('rect.bar')].map((bar) =>
      Number(bar.getAttribute('height')),
    );

    expect(heights).toHaveLength(3);
    expect(heights[0]).toBe(0); // an empty day has no bar
    expect(heights[1]).toBeCloseTo(heights[2] / 2, 5); // 5 clicks is half of 10
    expect(heights[2]).toBeGreaterThan(0);
  });

  it('gives a screen-reader summary and a tooltip per bar', () => {
    render(<BarChart series={series} interval="day" />);

    expect(screen.getByRole('img', { name: '15 clicks over 3 days' })).toBeInTheDocument();
    expect(screen.getAllByText(/: 10 clicks$/)).toHaveLength(1);
    expect(screen.queryAllByText(/: 1 click$/)).toHaveLength(0);
  });

  it('labels the axes with the first and last bucket and the maximum', () => {
    const { container } = render(<BarChart series={series} interval="day" />);
    const labels = [...container.querySelectorAll('text')].map((t) => t.textContent);

    expect(labels).toContain('10'); // y-axis maximum
    expect(labels).toContain('0');
    expect(labels.some((l) => l.includes('1'))).toBe(true); // first day
    expect(labels.some((l) => l.includes('3'))).toBe(true); // last day
  });

  it('says hours when the buckets are hourly', () => {
    render(<BarChart series={series} interval="hour" />);
    expect(screen.getByRole('img', { name: '15 clicks over 3 hours' })).toBeInTheDocument();
  });

  it('copes with an empty series', () => {
    const { container } = render(<BarChart series={[]} interval="day" />);
    expect(container.querySelectorAll('rect.bar')).toHaveLength(0);
    expect(screen.getByRole('img', { name: '0 clicks over 0 days' })).toBeInTheDocument();
  });

  it('keeps a single click visible even next to a huge bucket', () => {
    const { container } = render(
      <BarChart
        interval="day"
        series={[
          { bucket: day(1), clicks: 1 },
          { bucket: day(2), clicks: 100_000 },
        ]}
      />,
    );
    const [small] = [...container.querySelectorAll('rect.bar')];
    expect(Number(small.getAttribute('height'))).toBeGreaterThanOrEqual(1);
  });
});
