import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const mediaAssetsTable = pgTable("media_assets", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  dataBase64: text("data_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MediaAsset = typeof mediaAssetsTable.$inferSelect;
