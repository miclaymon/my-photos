CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`cover_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `album_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` text NOT NULL,
	`media_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`caption` text,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `album_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`permission` text NOT NULL,
	`granted_at` integer NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
