import { Router, type IRouter } from "express";
import healthRouter from "./health";
import templatesRouter from "./templates";
import projectsRouter from "./projects";
import dashboardRouter from "./dashboard";
import uploadsRouter from "./uploads";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/templates", templatesRouter);
router.use("/projects", projectsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/uploads", uploadsRouter);

export default router;
