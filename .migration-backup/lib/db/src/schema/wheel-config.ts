import { pgTable, serial, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const wheelSlotsTable = pgTable("wheel_slots", {
  id: serial("id").primaryKey(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  probability: integer("probability").notNull().default(0),
  displayOrder: integer("display_order").notNull().default(0),
});

export const insertWheelSlotSchema = createInsertSchema(wheelSlotsTable).omit({ id: true });
export type InsertWheelSlot = z.infer<typeof insertWheelSlotSchema>;
export type WheelSlot = typeof wheelSlotsTable.$inferSelect;
