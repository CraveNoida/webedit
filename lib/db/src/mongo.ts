import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { MediaAsset } from "./schema/media-assets";
import type { Project } from "./schema/projects";
import type { Template } from "./schema/templates";

type CounterDoc = { _id: string; seq: number };
type Stored<T> = T & { _id?: unknown };

let clientPromise: Promise<MongoClient> | null = null;
const memoryStore = {
  templates: [] as Template[],
  projects: [] as Project[],
  mediaAssets: [] as MediaAsset[],
  counters: {
    templates: 0,
    projects: 0,
    media_assets: 0,
  },
};

function mongoUrl(): string {
  const url = process.env.MONGODB_URI ?? process.env.DATABASE_URL;
  if (!url?.startsWith("mongodb")) {
    throw new Error("Set MONGODB_URI or DATABASE_URL to your MongoDB connection string.");
  }
  return url;
}

function mongoDatabaseName(url: string): string {
  const configured = process.env.MONGODB_DATABASE?.trim();
  if (configured) return configured;

  try {
    const dbName = new URL(url).pathname.replace(/^\/+/, "").trim();
    return dbName || "webedit";
  } catch {
    return "webedit";
  }
}

async function client(): Promise<MongoClient> {
  clientPromise ??= new MongoClient(mongoUrl(), {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
  }).connect().catch((err) => {
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}

async function database(): Promise<Db> {
  const url = mongoUrl();
  return (await client()).db(mongoDatabaseName(url));
}

async function collection<T extends Document>(name: string): Promise<Collection<T>> {
  return (await database()).collection<T>(name);
}

function toPublic<T>(doc: Stored<T> | null): T | null {
  if (!doc) return null;
  const { _id, ...rest } = doc as Stored<T>;
  void _id;
  return rest as T;
}

async function nextId(name: string): Promise<number> {
  const counters = await collection<CounterDoc>("counters");
  const result = await counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return result?.seq ?? 1;
}

function withTimestamps<T extends Record<string, unknown>>(data: T): T & { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { ...data, createdAt: now, updatedAt: now };
}

function memoryNextId(name: keyof typeof memoryStore.counters): number {
  memoryStore.counters[name] += 1;
  return memoryStore.counters[name];
}

function categoryCounts(items: Array<{ category: string }>): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }));
}

export async function ensureMongoDatabase(): Promise<void> {
  const db = await database();
  await Promise.all([
    db.collection("templates").createIndex({ id: 1 }, { unique: true }),
    db.collection("templates").createIndex({ category: 1 }),
    db.collection("projects").createIndex({ id: 1 }, { unique: true }),
    db.collection("projects").createIndex({ category: 1 }),
    db.collection("media_assets").createIndex({ id: 1 }, { unique: true }),
  ]);
}

export async function listTemplates(category?: string): Promise<Template[]> {
  try {
    const templates = await collection<Stored<Template>>("templates");
    return (await templates.find(category ? { category } : {}).sort({ createdAt: 1 }).toArray())
      .map((doc) => toPublic(doc)!);
  } catch {
    return memoryStore.templates.filter((template) => !category || template.category === category);
  }
}

export async function createTemplate(data: Omit<Template, "id" | "createdAt" | "updatedAt">): Promise<Template> {
  try {
    const templates = await collection<Stored<Template>>("templates");
    const template = { id: await nextId("templates"), ...withTimestamps(data) } as Template;
    await templates.insertOne(template);
    return template;
  } catch {
    const template = { id: memoryNextId("templates"), ...withTimestamps(data) } as Template;
    memoryStore.templates.push(template);
    return template;
  }
}

export async function getTemplate(id: number): Promise<Template | null> {
  try {
    const templates = await collection<Stored<Template>>("templates");
    return toPublic(await templates.findOne({ id }));
  } catch {
    return memoryStore.templates.find((template) => template.id === id) ?? null;
  }
}

export async function updateTemplate(id: number, data: Partial<Template>): Promise<Template | null> {
  try {
    const templates = await collection<Stored<Template>>("templates");
    const result = await templates.findOneAndUpdate(
      { id },
      { $set: { ...data, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    return toPublic(result);
  } catch {
    const index = memoryStore.templates.findIndex((template) => template.id === id);
    if (index < 0) return null;
    const updated = { ...memoryStore.templates[index], ...data, updatedAt: new Date() } as Template;
    memoryStore.templates[index] = updated;
    return updated;
  }
}

export async function deleteTemplate(id: number): Promise<void> {
  try {
    const templates = await collection<Stored<Template>>("templates");
    await templates.deleteOne({ id });
  } catch {
    memoryStore.templates = memoryStore.templates.filter((template) => template.id !== id);
  }
}

export async function listProjects(input: { category?: string; search?: string } = {}): Promise<Project[]> {
  try {
    const projects = await collection<Stored<Project>>("projects");
    const filter: Record<string, unknown> = {};
    if (input.category) filter.category = input.category;
    if (input.search) filter.businessName = { $regex: input.search, $options: "i" };
    return (await projects.find(filter).sort({ updatedAt: -1 }).toArray()).map((doc) => toPublic(doc)!);
  } catch {
    const search = input.search?.toLowerCase();
    return memoryStore.projects
      .filter((project) => !input.category || project.category === input.category)
      .filter((project) => !search || project.businessName.toLowerCase().includes(search))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
}

export async function createProject(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
  try {
    const projects = await collection<Stored<Project>>("projects");
    const project = { id: await nextId("projects"), ...withTimestamps(data) } as Project;
    await projects.insertOne(project);
    return project;
  } catch {
    const project = { id: memoryNextId("projects"), ...withTimestamps(data) } as Project;
    memoryStore.projects.push(project);
    return project;
  }
}

export async function getProject(id: number): Promise<Project | null> {
  try {
    const projects = await collection<Stored<Project>>("projects");
    return toPublic(await projects.findOne({ id }));
  } catch {
    return memoryStore.projects.find((project) => project.id === id) ?? null;
  }
}

export async function updateProject(id: number, data: Partial<Project>): Promise<Project | null> {
  try {
    const projects = await collection<Stored<Project>>("projects");
    const result = await projects.findOneAndUpdate(
      { id },
      { $set: { ...data, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    return toPublic(result);
  } catch {
    const index = memoryStore.projects.findIndex((project) => project.id === id);
    if (index < 0) return null;
    const updated = { ...memoryStore.projects[index], ...data, updatedAt: new Date() } as Project;
    memoryStore.projects[index] = updated;
    return updated;
  }
}

export async function deleteProject(id: number): Promise<void> {
  try {
    const projects = await collection<Stored<Project>>("projects");
    await projects.deleteOne({ id });
  } catch {
    memoryStore.projects = memoryStore.projects.filter((project) => project.id !== id);
  }
}

export async function dashboardStats() {
  try {
    const [templates, projects] = await Promise.all([
      collection<Stored<Template>>("templates"),
      collection<Stored<Project>>("projects"),
    ]);

    const [totalTemplates, totalProjects, recentProjects, templatesByCategory, projectsByCategory] =
      await Promise.all([
        templates.countDocuments(),
        projects.countDocuments(),
        projects.find({}).sort({ updatedAt: -1 }).limit(5).toArray(),
        templates.aggregate<{ category: string; count: number }>([
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $project: { _id: 0, category: "$_id", count: 1 } },
        ]).toArray(),
        projects.aggregate<{ category: string; count: number }>([
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $project: { _id: 0, category: "$_id", count: 1 } },
        ]).toArray(),
      ]);

    return {
      totalTemplates,
      totalProjects,
      recentProjects: recentProjects.map((doc) => toPublic(doc)!),
      templatesByCategory,
      projectsByCategory,
    };
  } catch {
    const recentProjects = [...memoryStore.projects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
    return {
      totalTemplates: memoryStore.templates.length,
      totalProjects: memoryStore.projects.length,
      recentProjects,
      templatesByCategory: categoryCounts(memoryStore.templates),
      projectsByCategory: categoryCounts(memoryStore.projects),
      databaseStatus: "memory-fallback",
    };
  }
}

export async function createMediaAsset(data: Omit<MediaAsset, "id" | "createdAt">): Promise<MediaAsset> {
  try {
    const assets = await collection<Stored<MediaAsset>>("media_assets");
    const asset = { id: await nextId("media_assets"), ...data, createdAt: new Date() } as MediaAsset;
    await assets.insertOne(asset);
    return asset;
  } catch {
    const asset = { id: memoryNextId("media_assets"), ...data, createdAt: new Date() } as MediaAsset;
    memoryStore.mediaAssets.push(asset);
    return asset;
  }
}

export async function getMediaAsset(id: number): Promise<MediaAsset | null> {
  try {
    const assets = await collection<Stored<MediaAsset>>("media_assets");
    return toPublic(await assets.findOne({ id }));
  } catch {
    return memoryStore.mediaAssets.find((asset) => asset.id === id) ?? null;
  }
}
