# Wayfarer on ChatGPT Sites

The existing Travel-Tool interface, adapted for private hosting on ChatGPT Sites. It includes the sanitized California itinerary for December 18–25, 2026, editable stops, a schematic Leaflet map, private document storage, and reviewable PDF/text imports.

Sites manages sign-in and access. The current audience is the owner alone. There are no passwords, public account registration, or app-generated invitation codes. Any future companion must be admitted through the Site’s sharing settings; the app accepts at most two travelers. Admitted travelers share the trip and its documents.

Trip records and document metadata use the `DB` D1 binding. Original documents use the `BUCKET` R2 binding. Hosted migrations run during publication. Local preview data is separate and is never included in the deployment.

The My trips breadcrumb opens the trip collection. Page navigation uses URL fragments, preserving the selected page on reload and supporting browser Back and Forward.

Booking uploads are compared with existing itinerary stops using readable PDF/TXT/EML text. Matching dates plus flight numbers, routes, or property/place names can preselect a clear attachment. Ambiguous matches require a choice, and manual stop selections are preserved. Booking documents never generate duplicate stops or change a booking's reported status. Images and scanned PDFs require manual selection; no OCR or AI service is connected.

An explicitly labeled hotel checkout time can be saved with the matched overnight stay during upload. The original document and checkout metadata commit together with optimistic concurrency protection. Uploaded booking times take priority; absent a booking time, the two known hotels show sourced standard policies checked October 11, 2026. Conflicts with the original itinerary remain visible. Unknown properties are not guessed. Checkout deadlines and planned departure times stay separate.

The December 21 and 22 park routes have source-linked reviews based on the NPS road network, with guarded stop reordering for the original locations. Changed locations need another review. The map remains schematic, and neither road conditions nor driving times are live. AA and Alaska flights have departure-zone-aware check-in countdowns and official airline links. Boarding passes can be stored against their flight; airline check-in is not automated and there are no background reminders.

The original December 22 ordering is corrected once on the next trip read, using an optimistic version check. The correction preserves notes, bookings, other days and custom orders, and skips changed places or conflicting times. A stored route revision prevents it from recurring after later manual changes.

The map icon opens Google Maps with the selected day's saved stop order. Known locations use qualified names, hotel addresses and park trailhead/parking targets. Directions update immediately after edits; Google resolves new names when opened, without a separate geocoding service. Long days offer overlapping route parts within Google Maps' mobile waypoint limits. Island boat trips remain separate from mainland driving, and unfinished hotel locations remain visibly unresolved. Booking references and document contents are excluded from map URLs.

Use Node 24 and the Sites plugin setup, install, build and publishing helpers. `npm test` covers private access, persistence, conflicts, document validation and the two-person limit. `npm run test:e2e` checks the interface, PDF import and mobile layout against a running development server on port 5173.

The app starts from a sanitized sample only. It does not book travel, verify confirmations, retrieve live conditions or perform OCR. Existing dependencies retain their licenses. Recovered original source: https://github.com/himeshFHF/Travel-Tool.
