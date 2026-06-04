import { Router } from "express";
import { db, templatesTable, projectsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/stats", async (req, res): Promise<void> => {
  const [templateCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(templatesTable);

  const [projectCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectsTable);

  const recentProjects = await db
    .select()
    .from(projectsTable)
    .orderBy(sql`${projectsTable.updatedAt} DESC`)
    .limit(5);

  const templatesByCategory = await db
    .select({
      category: templatesTable.category,
      count: sql<number>`count(*)::int`,
    })
    .from(templatesTable)
    .groupBy(templatesTable.category);

  const projectsByCategory = await db
    .select({
      category: projectsTable.category,
      count: sql<number>`count(*)::int`,
    })
    .from(projectsTable)
    .groupBy(projectsTable.category);

  res.json({
    totalTemplates: templateCount?.count ?? 0,
    totalProjects: projectCount?.count ?? 0,
    recentProjects,
    templatesByCategory,
    projectsByCategory,
  });
});

export default router;
