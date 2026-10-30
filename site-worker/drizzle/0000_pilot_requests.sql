CREATE TABLE `pilot_requests` (
 `id` text PRIMARY KEY NOT NULL,
 `name` text NOT NULL,
 `email` text NOT NULL,
 `workflow` text NOT NULL,
 `monthly_budget_cents` integer,
 `proposed_fee_usd` integer DEFAULT 149 NOT NULL,
 `status` text DEFAULT 'new' NOT NULL,
 `deletion_hash` text NOT NULL,
 `consent_at` integer NOT NULL,
 `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_limits` (
 `id` text PRIMARY KEY NOT NULL,
 `count` integer NOT NULL,
 `expires_at` integer NOT NULL
);
