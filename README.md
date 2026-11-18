# Sourcing Desk

AI sourcing agent for purchasing teams at small and medium Thai manufacturers.
A buyer drops in a part list; the agent finds suppliers, drafts RFQ emails, reads the
quotes that come back, compares them, checks the standard-price band and drafts the POs.
The buyer (or the purchasing head, when a price is above the band) approves every step.

**Status:** MVP for demos. All suppliers, prices and emails are sample data, and the
mailbox is simulated: no real email is sent.

## How it runs

The app is a React + TypeScript single-page app that builds into **one HTML file**:

- **Now: a claude.ai artifact.** The agent runs on Claude through the viewer's own
  Claude account (the artifact `sample` capability, with page functions as tools).
  Without it, a scripted agent handles the common briefs so the demo still works.
  PO files are saved through the artifact `downloads` capability. State is kept in the
  viewer's browser.
- **Later: a desktop app.** The same bundle can be wrapped in [Tauri](https://tauri.app)
  (Rust shell, ~10 MB installer) and pointed at our own API platform instead of the
  artifact runtime. See "Next steps".

```bash
npm install
npm run dev        # local dev server (scripted agent, browser downloads)
npm test           # logic tests: intake, sourcing, quote reading, comparison, PO
npm run typecheck
npm run build      # dist/sourcing-desk.html, ready to publish as an artifact
```

## The flow

1. **Part list intake.** Upload a BOM/MRP export (.xlsx/.csv, Thai or English headers),
   paste lines, or (with Claude) attach a photo of a BOM or LINE chat.
2. **Supplier search.** At least 3 candidates per part: company suppliers first, then new
   ones from search (marked unaudited). Spot-market sellers only when needed.
3. **RFQ drafting.** One email per supplier, in Thai or English. The buyer edits and
   presses Send all; the agent cannot send by itself.
4. **Quote reading.** Replies arrive in the simulated mailbox in different formats; the
   agent pulls out price, MOQ, lead time, payment terms and validity.
5. **Comparison.** Scores price, lead time vs need-by date, credit terms, MOQ and supplier
   trust; picks one per part and says why. The buyer can pick another.
6. **Standard-price band (PPV).** Inside the band the buyer approves; above it, the
   purchasing head approves (LINE notification is mocked).
7. **PO draft.** One PO per supplier with quantity, price, validity and total checks,
   downloadable as Excel. Every step is in the audit log.

## Code map

| Path | What |
| --- | --- |
| `src/shared/types.ts` | Data model |
| `src/shared/logic.ts` | Pure purchasing logic (no UI), covered by `tests/` |
| `src/shared/sample.ts` | Sample item master, BOM and 12 invented suppliers |
| `src/app/store.ts` | App state, actions, simulated mailbox |
| `src/app/agent.ts` | Claude agent loop with tools, plus the scripted fallback |
| `src/app/files.ts` | Excel in (BOM) and out (PO) |
| `src/app/screens/` | Requests board, workspace, approvals, suppliers, mailbox, settings |
| `scripts/to-artifact.mjs` | Folds the Vite build into one artifact page |

## Next steps

- Real email (Gmail / Outlook) in place of the simulated mailbox.
- Swap the artifact `sample` call for our API platform's `/v1/agent` endpoint.
- Tauri desktop shell and Windows installer.
- Shared state for the whole purchasing team (the artifact `db` capability, then Postgres).
- Delivery follow-up from PO to goods received; ERP/accounting connectors.
