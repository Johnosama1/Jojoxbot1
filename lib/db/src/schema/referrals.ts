import { pgTable, serial, bigint, text, timestamp, integer } from "drizzle-orm/pg-core";

export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: bigint("referrer_id", { mode: "number" }).notNull(),
  referredId: bigint("referred_id", { mode: "number" }).notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  removedAt: timestamp("removed_at"),
  warnedAt: timestamp("warned_at"),
  warnMsgId: integer("warn_msg_id"),
});

export type Referral = typeof referralsTable.$inferSelect;
