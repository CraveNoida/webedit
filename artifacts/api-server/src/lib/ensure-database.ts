import { mongo } from "@workspace/db";

export async function ensureDatabase() {
  await mongo.ensureMongoDatabase();
}
