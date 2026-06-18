import { pool } from "@workspace/db";

export async function ensureDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id serial PRIMARY KEY,
      name text NOT NULL,
      category text NOT NULL,
      description text,
      html_content text NOT NULL,
      css_content text,
      js_content text,
      thumbnail_url text,
      placeholders text[] NOT NULL DEFAULT ARRAY[]::text[],
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id serial PRIMARY KEY,
      business_name text NOT NULL,
      category text NOT NULL,
      tagline text,
      about text,
      phone text,
      whatsapp text,
      email text,
      address text,
      google_maps_link text,
      instagram_link text,
      services text[] NOT NULL DEFAULT ARRAY[]::text[],
      packages jsonb NOT NULL DEFAULT '[]'::jsonb,
      cta_text text,
      primary_color text,
      secondary_color text,
      logo_url text,
      hero_image_url text,
      gallery_images text[] NOT NULL DEFAULT ARRAY[]::text[],
      template_id integer,
      generated_html text,
      status text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
