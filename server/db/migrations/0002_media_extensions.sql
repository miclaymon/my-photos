ALTER TABLE `media` ADD COLUMN `thumbnail_object_key` text;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `preview_object_key` text;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `exif_data` text;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `hash` text;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `archived_at` integer;
--> statement-breakpoint
ALTER TABLE `media` ADD COLUMN `deletion_date` integer;
--> statement-breakpoint
CREATE TABLE `deleted_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` text NOT NULL,
	`deleted_by` integer NOT NULL,
	`deletion_date` integer NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
