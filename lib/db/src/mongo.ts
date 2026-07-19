import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type { MediaAsset } from "./schema/media-assets";
import type { Project } from "./schema/projects";
import type { Template } from "./schema/templates";

type CounterDoc = { _id: string; seq: number };
type Stored<T> = T & { _id?: unknown };

let clientPromise: Promise<MongoClient> | null = null;

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
  }).connect();
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
  const templates = await collection<Stored<Template>>("templates");
  return (await templates.find(category ? { category } : {}).sort({ createdAt: 1 }).toArray())
    .map((doc) => toPublic(doc)!);
}

export async function createTemplate(data: Omit<Template, "id" | "createdAt" | "updatedAt">): Promise<Template> {
  const templates = await collection<Stored<Template>>("templates");
  const template = { id: await nextId("templates"), ...withTimestamps(data) } as Template;
  await templates.insertOne(template);
  return template;
}

export async function getTemplate(id: number): Promise<Template | null> {
  const templates = await collection<Stored<Template>>("templates");
  return toPublic(await templates.findOne({ id }));
}

export async function updateTemplate(id: number, data: Partial<Template>): Promise<Template | null> {
  const templates = await collection<Stored<Template>>("templates");
  const result = await templates.findOneAndUpdate(
    { id },
    { $set: { ...data, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return toPublic(result);
}

export async function deleteTemplate(id: number): Promise<void> {
  const templates = await collection<Stored<Template>>("templates");
  await templates.deleteOne({ id });
}

export async function listProjects(input: { category?: string; search?: string } = {}): Promise<Project[]> {
  const projects = await collection<Stored<Project>>("projects");
  const filter: Record<string, unknown> = {};
  if (input.category) filter.category = input.category;
  if (input.search) filter.businessName = { $regex: input.search, $options: "i" };
  return (await projects.find(filter).sort({ updatedAt: -1 }).toArray()).map((doc) => toPublic(doc)!);
}

export async function createProject(data: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
  const projects = await collection<Stored<Project>>("projects");
  const project = { id: await nextId("projects"), ...withTimestamps(data) } as Project;
  await projects.insertOne(project);
  return project;
}

export async function getProject(id: number): Promise<Project | null> {
  const projects = await collection<Stored<Project>>("projects");
  return toPublic(await projects.findOne({ id }));
}

export async function updateProject(id: number, data: Partial<Project>): Promise<Project | null> {
  const projects = await collection<Stored<Project>>("projects");
  const result = await projects.findOneAndUpdate(
    { id },
    { $set: { ...data, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return toPublic(result);
}

export async function deleteProject(id: number): Promise<void> {
  const projects = await collection<Stored<Project>>("projects");
  await projects.deleteOne({ id });
}

export async function dashboardStats() {
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
}

export async function createMediaAsset(data: Omit<MediaAsset, "id" | "createdAt">): Promise<MediaAsset> {
  const assets = await collection<Stored<MediaAsset>>("media_assets");
  const asset = { id: await nextId("media_assets"), ...data, createdAt: new Date() } as MediaAsset;
  await assets.insertOne(asset);
  return asset;
}

export async function getMediaAsset(id: number): Promise<MediaAsset | null> {
  const assets = await collection<Stored<MediaAsset>>("media_assets");
  return toPublic(await assets.findOne({ id }));
}
