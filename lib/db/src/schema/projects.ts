import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  category: text("category").notNull(),
  tagline: text("tagline"),
  about: text("about"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  address: text("address"),
  googleMapsLink: text("google_maps_link"),
  instagramLink: text("instagram_link"),
  services: text("services").array().notNull().default([]),
  packages: jsonb("packages").notNull().default([]),
  ctaText: text("cta_text"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  logoUrl: text("logo_url"),
  heroImageUrl: text("hero_image_url"),
  galleryImages: text("gallery_images").array().notNull().default([]),
  templateId: integer("template_id"),
  generatedHtml: text("generated_html"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
