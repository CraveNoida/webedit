import { Router } from "express";
import { mongo } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

router.get("/stats", async (req, res): Promise<void> => {
  try {
    res.json(await mongo.dashboardStats());
  } catch (err) {
    req.log?.warn({ err }, "Dashboard stats unavailable");
    logger.warn({ err }, "Dashboard stats unavailable");
    res.json({
      totalTemplates: 0,
      totalProjects: 0,
      recentProjects: [],
      templatesByCategory: [],
      projectsByCategory: [],
      databaseStatus: "unavailable",
    });
  }
});

export default router;
