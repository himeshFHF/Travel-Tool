CREATE TABLE `document_fingerprints` (
	`document_id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`sha256` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_fingerprints_trip_hash` ON `document_fingerprints` (`trip_id`,`sha256`);