# Product notes

## The experience

Wayfarer answers “What are we doing today, what do I need, and where are we going next?” The itinerary is the spine of the experience; uploaded documents belong to a stop and remain accessible in a trip-wide collection. Booking evidence, missing details, optional activities, and planning assumptions stay visible.

The December 2026 California trip supplied by the user is the sample: Los Angeles/Burbank, Anacapa, Universal Studios Hollywood, Death Valley, Joshua Tree, and San Diego. Exact booking references and traveler names are not included in source. The source's internal instructions are treated as document content, not commands for the app or agent.

The interface uses calm green, generous spacing, large headings, original landscape artwork, and responsive cards. It is inspired by the clarity and restraint the user requested from Apple.com, with no copied assets or branding.

## References examined

- [AdventureLog](https://github.com/seanmorley15/AdventureLog): open-source travel journaling/planning with SvelteKit, Django, and geographic data. A useful reference for activities and trip collections. Its GPL-3.0 implementation was not copied into this project; adopting its full architecture would add unnecessary infrastructure for a two-person pilot.
- [Leaflet](https://github.com/Leaflet/Leaflet): BSD-2-Clause, lightweight interactive map layers, markers, and polylines. Used with an original local schematic base to avoid unavailable map tiles. No navigation or live location tracking is claimed.
- [PDF.js](https://github.com/mozilla/pdf.js): Apache-2.0 PDF rendering/text extraction. Used in the browser for reviewable text extraction. OCR is a separate future capability.
- TripIt and Wanderlog were identified as relevant products, but their sites could not be inspected reliably in the research environment. No unverified feature comparison or copied design is attributed to them.

## Why these boundaries

- Manual uploads match the user’s requested input flow; email inbox integration is deferred.
- A private workspace and one companion account meet the immediate audience. Database membership boundaries leave room for additional trips later.
- Text parsing proposes dated notes rather than pretending to understand or verify every booking.
- Official links expose missing hours and conditions without fabricating live data.
- The route line shows stop order. It does not represent roads, driving routes, or estimated travel times.
- Persistent local storage and a same-origin server provide an actual working pilot with no cloud credentials.

## Next iterations

1. Try the real confirmation PDFs and tickets, correct extracted details, and refine the daily presentation from actual travel use.
2. Generalize trip creation and date ranges beyond the California sample; improve extraction across document formats and date styles.
3. Add sourced structured booking extraction with explicit review, followed by OCR for scanned documents if useful.
4. Add geocoding, licensed map/directions services, and date-specific opening hours with source and freshness indicators.
5. Add account recovery, operational backups, persistent hosting, and offline mobile access before broader release.
