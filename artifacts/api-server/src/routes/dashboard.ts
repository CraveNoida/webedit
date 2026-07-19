import { Router } from "express";
import { mongo } from "@workspace/db";

const router = Router();

router.get("/stats", async (req, res): Promise<void> => {
  res.json(await mongo.dashboardStats());
});

export default router;
