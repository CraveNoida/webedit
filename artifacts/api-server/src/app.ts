import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const allowedOrigins = new Set([
  "https://webedit-482.pages.dev",
  "https://webedit.pages.dev",
  ...(process.env["CORS_ORIGIN"]
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
]);

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "https:" && hostname.endsWith(".pages.dev");
  } catch {
    return false;
  }
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
  }),
);
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Webedit API",
    status: "ok",
    health: "/api/healthz",
  });
});

app.use("/api", router);

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  req.log?.error({ err }, "Unhandled API error");

  if (status === 413 || err?.type === "entity.too.large") {
    res.status(413).json({
      error: "Template is too large to save. Remove large files from the folder, then import again.",
    });
    return;
  }

  res.status(status).json({
    error: status >= 500 ? "Internal server error" : err?.message ?? "Request failed",
  });
};

app.use(errorHandler);

export default app;
