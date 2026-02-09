# Market Value Chart (Removed)

The real-time ASCII chart has been removed as part of the streams simplification.

## Rationale

The chart relied on near-1s update frequency from `pnlSingle` streams, which provided enough data points to render meaningful chart motion. After switching to the account-updates-only model, the update cadence is event-driven (often minutes between updates in quiet markets), making a real-time chart impractical.

## Previous Implementation

- Used `asciichart` library for ASCII rendering
- Data stored in Zustand store as circular buffer (300 points max)
- Updated every ~1 second via `pnlSingle` events
- Plotted delta from session baseline with hysteresis scaling

## Reintroduction Path

To bring the chart back, the app would need a higher-frequency data source such as `reqMktData` for per-position market data. This is tracked as a future option in the architecture docs.
