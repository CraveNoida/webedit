import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const result = spawnSync(
  pnpm,
  ["--filter", "@workspace/webjal-studio", "run", "build"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: process.env.PORT || "8080",
      BASE_PATH: process.env.BASE_PATH || "/",
      API_PROXY_TARGET: process.env.API_PROXY_TARGET || "",
    },
  },
);

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
