# Main Flow Walkthrough

This document traces the runtime flow end-to-end with executable references (`file:line`) so you can follow the app path directly in code.

## 1) Startup + Connect Sequence

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant CLI as "CLI (src/index.ts)"
    participant App as "App (src/tui/App.tsx)"
    participant Store as "Zustand Store (src/state/store.ts)"
    participant Broker as "IBKRBroker (src/broker/ibkr/IBKRBroker.ts)"
    participant IB as "IB Gateway / TWS"

    User->>CLI: Run ib-tui with optional logging flags
    CLI->>CLI: Parse/validate CLI flags
    alt --log-file provided
        CLI->>CLI: configureLogging(...)
    end
    CLI->>App: render(<App />)
    Note over App: App waits for keyboard input

    User->>App: Press c
    App->>Store: connect()
    Store->>Broker: broker.connect()
    Broker->>IB: api.connect(clientId)
    IB-->>Broker: nextValidId
    Broker-->>Store: connect() resolves
    Store->>Store: connectionStatus = "connected"

    App->>App: MainView renders PortfolioView
    App->>Store: subscribePortfolio()
    Store->>Broker: broker.subscribePortfolio(callback)
    Broker->>IB: reqAccountUpdates(true, account)
```

## 2) Event Propagation Sequence (IBKR -> Store -> UI)

```mermaid
sequenceDiagram
    autonumber
    participant IB as "IB Gateway / TWS"
    participant Sub as "createPortfolioSubscription"
    participant Tracker as "contractDetailsTracker"
    participant Projection as "portfolioProjection"
    participant Store as "Zustand Store"
    participant View as "PortfolioView"

    IB-->>Sub: updatePortfolio(...)
    Sub->>Projection: applyPortfolioUpdate(...)
    Sub->>Tracker: nextRequest(contract)
    alt First time seeing conId
        Sub->>IB: reqContractDetails(reqId, contract)
    end
    Sub->>Store: callback(projection.snapshot())
    Store->>Store: set({ positions, totalEquity, ... })
    Store-->>View: selectors trigger re-render

    IB-->>Sub: updateAccountValue("TotalCashBalance", ..., "BASE")
    Sub->>Projection: applyCashBalance(value)
    Sub->>Store: callback(snapshot)

    IB-->>Sub: contractDetails(reqId, details)
    Sub->>Tracker: onContractDetails(reqId, details)
    Tracker-->>Sub: { conId, marketHours }
    Sub->>Projection: attachMarketHours(conId, marketHours)
    Sub->>Store: callback(snapshot)
    View->>View: resolveMarketHours(...) per position row

    IB-->>Sub: accountDownloadEnd(account)
    Sub->>Projection: markInitialLoadComplete()
    Sub->>Store: callback(snapshot)
    Store-->>View: initialLoadComplete=true enables table
```

## 3) Step-by-Step File:Line Trace

### Startup to First Subscription

1. `src/index.ts:10` reads CLI args (`process.argv.slice(2)`).
2. `src/index.ts:25` and `src/index.ts:26` parse `--log-file` / `--log-level`.
3. `src/index.ts:41` configures file logging when requested.
4. `src/index.ts:63` renders Ink with `<App />`.
5. `src/state/store.ts:26` creates a single broker instance (`new IBKRBroker()`).
6. `src/tui/App.tsx:13` registers keyboard handlers (`c` connect, `q` quit).
7. `src/tui/App.tsx:17` calls `connect()` when `c` is pressed from disconnected/error states.
8. `src/state/store.ts:38` moves status to `"connecting"`.
9. `src/broker/ibkr/IBKRBroker.ts:62` creates `IBApi`; `src/broker/ibkr/IBKRBroker.ts:67` wires event handlers.
10. `src/broker/ibkr/IBKRBroker.ts:74` waits for `nextValidId` to resolve connection.
11. `src/state/store.ts:57` sets status to `"connected"`.
12. `src/tui/App.tsx:54` now renders `PortfolioView`.
13. `src/tui/PortfolioView.tsx:172` mount effect calls `subscribePortfolio()`.
14. `src/state/store.ts:83` delegates to `broker.subscribePortfolio(...)`.
15. `src/broker/ibkr/IBKRBroker.ts:137` builds portfolio subscription through `createPortfolioSubscription(...)`.
16. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:109` to `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:113` register IB event listeners.
17. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:116` starts `reqAccountUpdates(true, accountId)`.

### Broker Identity and Account Selection

1. `src/broker/ibkr/IBKRBroker.ts:51` handles `managedAccounts`.
2. `src/broker/ibkr/IBKRBroker.ts:54` stores the selected primary `accountId`.
3. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:24` reads account ID lazily (string or function).
4. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:27` to `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:30` filters events by account, but accepts all when account ID is still empty.

### `updatePortfolio` Event Path

1. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:32` receives `updatePortfolio`.
2. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:55` applies event data into projection state.
3. `src/broker/ibkr/portfolio/portfolioProjection.ts:25` to `src/broker/ibkr/portfolio/portfolioProjection.ts:48` upserts/removes position and recomputes market value.
4. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:57` reuses cached market-hours if present.
5. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:60` asks tracker if contract details must be fetched.
6. `src/broker/ibkr/portfolio/contractDetailsTracker.ts:26` to `src/broker/ibkr/portfolio/contractDetailsTracker.ts:43` deduplicates and allocates `reqId`.
7. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:63` issues `reqContractDetails` when needed.
8. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:65` emits current snapshot to the store callback.
9. `src/state/store.ts:92` to `src/state/store.ts:99` writes snapshot fields into Zustand state.
10. `src/tui/PortfolioView.tsx:158` to `src/tui/PortfolioView.tsx:163` selectors read updated state and re-render.

### `updateAccountValue` Cash Path

1. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:68` receives `updateAccountValue`.
2. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:74` keeps only `TotalCashBalance` in `BASE`.
3. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:78` updates cash in projection.
4. `src/broker/ibkr/portfolio/portfolioProjection.ts:50` to `src/broker/ibkr/portfolio/portfolioProjection.ts:53` parses and stores cash.
5. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:79` emits a new snapshot.

### `contractDetails` Market-Hours Enrichment Path

1. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:92` receives `contractDetails`.
2. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:101` correlates via tracker.
3. `src/broker/ibkr/portfolio/contractDetailsTracker.ts:45` to `src/broker/ibkr/portfolio/contractDetailsTracker.ts:55` builds and caches `PositionMarketHours`.
4. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:103` attaches market hours to existing position.
5. `src/broker/ibkr/portfolio/portfolioProjection.ts:60` to `src/broker/ibkr/portfolio/portfolioProjection.ts:65` merges market-hours into position state.
6. `src/tui/PortfolioView.tsx:73` computes open/closed status via `resolveMarketHours(...)`.
7. `src/broker/ibkr/market-hours/resolveMarketHours.ts:131` to `src/broker/ibkr/market-hours/resolveMarketHours.ts:176` parses schedule and computes transition countdown.

### Initial Snapshot Completion Path

1. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:82` handles `accountDownloadEnd`.
2. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:88` marks initial load complete.
3. `src/broker/ibkr/portfolio/portfolioProjection.ts:55` to `src/broker/ibkr/portfolio/portfolioProjection.ts:58` flips `initialLoadComplete`.
4. `src/tui/PortfolioView.tsx:177` switches UI from loading message to table once this is true.

### Disconnect and Cleanup Path

1. `src/tui/App.tsx:14` to `src/tui/App.tsx:16` handles `q` / `Ctrl+C`, calls `disconnect()`, then exits Ink app.
2. `src/state/store.ts:64` to `src/state/store.ts:76` disconnects broker and clears portfolio state.
3. `src/broker/ibkr/IBKRBroker.ts:83` to `src/broker/ibkr/IBKRBroker.ts:89` calls underlying IB API disconnect.
4. `src/tui/PortfolioView.tsx:173` to `src/tui/PortfolioView.tsx:175` cleanup unsubscribes on unmount.
5. `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:118` to `src/broker/ibkr/portfolio/createPortfolioSubscription.ts:127` removes listeners and stops `reqAccountUpdates`.
6. `src/broker/ibkr/IBKRBroker.ts:35` to `src/broker/ibkr/IBKRBroker.ts:39` handles unexpected broker disconnect and fans out callbacks.
7. `src/state/store.ts:44` to `src/state/store.ts:55` receives that callback and resets state to `"disconnected"` with `"Connection lost"`.
