# Wayfarer

A private travel companion for two people. The first version uses a sanitized California itinerary for December 18–25, 2026, with a daily walkthrough, a schematic stop map, overnight stays, a document collection, and prompts for missing information.

## Run locally or in Codex

Requires **Node.js 24** (uses built-in SQLite) and npm.

```bash
npm ci
npm run dev
```

The server listens on port 3000. The first visitor creates the owner account; there is no default password. Use the plus button beside the traveler avatar to create a one-use invitation for your companion. Invitations expire after 24 hours. Both accounts can edit the same trip and access its documents.

```bash
npm run build
npm start
```

The production command serves the built app and API from one origin. Set `PORT` and `HOST` as needed. `DATA_DIR` defaults to `.data`; it contains the SQLite database and original uploads and must be on persistent storage. Back up that entire directory together. Set `COOKIE_SECURE=true` when serving over HTTPS. Account setup should be completed before sharing the app's address. Account recovery and email verification are not implemented in this private pilot.

## What works

- All eight sample travel days, with automatic selection of today in Pacific time while the trip is active. Other dates are explicitly previews or past days. Flight departure time uses its own time zone.
- Editable stops, local dates/times, status, location, coordinates, overnight checkout dates, details, and official-information links.
- A locally rendered Leaflet map with numbered stops and a connected sequence. Coordinates are geographic; coastline and terrain are schematic. No API keys, external tiles, navigation routes, or travel-time claims.
- Manually uploaded PDF, TXT, EML, PNG, JPEG, and WebP files, up to 20 MB each. File signatures are checked and file access requires membership in the trip. Files remain attached to their stop; removing a stop retains its documents in the trip collection.
- Text extraction from text-based PDFs and plain-text files. ISO dates and December dates can produce proposed day notes within the sample trip dates. Users review titles, discard suggestions, and explicitly add them. PDF extraction is limited to the first 30 pages. Dates without a year use 2026 for this sample. Saved email files may expose encoded text and need manual review.
- Missing-time, missing-confirmation, and unbooked-hotel prompts. A “booking reported” label means the uploaded source itinerary said it was booked; it does not independently verify a purchase. Adding a document resolves its missing-file prompt but does not validate its contents.
- A private two-person workspace with hashed passwords, opaque HttpOnly sessions, single-use invitations, membership checks, same-origin mutation checks, request limits, and version checks to prevent silently overwriting another traveler’s edits.

## Deliberate first-version limits

This is a single California trip workspace, not yet a general multi-trip planner. Uploads do not understand arbitrary itineraries or infer flight/hotel fields with AI. Image/scanned-PDF OCR, email integrations, live park hours, live road conditions, directions/ETAs, offline document caching, payments, public signup, and password recovery are not connected. Opening hours and conditions link to official sites for manual checking. Nothing makes or changes a booking.

Sample event coordinates and map artwork are approximate. The original source file, booking reference numbers, personal traveler identities, credentials, database, and uploaded documents are excluded from Git. Initial setup seeds only sanitized trip information.

## Validation

```bash
npm test
npm run build
npm run test:e2e
```

Browser tests require Chromium (`/usr/bin/chromium` by default; override with `CHROMIUM_PATH`). They start a separate server on port 3123 using a new temporary data directory, so your travel data is untouched. They cover setup, persistence, date navigation, PDF review/import, private file access, companion invitations, conflicting edits, bad file signatures, cross-origin rejection, and mobile layout. Unit tests cover time zones, missing details, conservative parsing, and sample consistency.

```bash
npm run format
```

## Implementation and references

React + TypeScript + Vite, Express, Node SQLite, Leaflet, PDF.js, and Lucide. No paid services or secrets are required. See [the product notes](docs/product-notes.md) for scope, research, and next steps. All visual artwork is original; dependencies retain their respective licenses.
