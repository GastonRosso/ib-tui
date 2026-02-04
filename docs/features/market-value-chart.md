# Market Value Chart

Real-time ASCII chart showing portfolio value over time.

## Usage

The chart appears above the portfolio table when connected. It displays up to 5 minutes of portfolio value history.

## Implementation

- Uses `asciichart` library for ASCII rendering
- Data stored in Zustand store as circular buffer (300 points max)
- Updates every ~1 second via portfolio subscription events from IBKR
- Samples data to fit terminal width
