CREATE TABLE "users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"photo_url" text,
	"balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"spins" integer DEFAULT 0 NOT NULL,
	"referral_count" integer DEFAULT 0 NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"referred_by" bigint,
	"is_visible" boolean DEFAULT true NOT NULL,
	"ip_hash" text,
	"ip_verified_at" timestamp,
	"user_agent" text,
	"verification_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"icon" text DEFAULT '⭐',
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"task_id" integer NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"wallet_address" text NOT NULL,
	"fee" numeric(18, 6) DEFAULT '0.05',
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "wheel_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"role" text DEFAULT 'admin' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
