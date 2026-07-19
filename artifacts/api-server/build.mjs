import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(artifactDir, "..", "..");
const webDir = path.resolve(workspaceDir, "artifacts", "webjal-studio");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const textAssetExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".svg",
  ".txt",
]);

function contentTypeForAsset(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json" || ext === ".map") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(fullPath) : fullPath;
    }),
  );
  return files.flat();
}

async function writeEmbeddedClientAssets(publicDir) {
  const files = await listFiles(publicDir);
  const assets = {};

  for (const filePath of files) {
    const routePath = `/${path.relative(publicDir, filePath).replace(/\\/g, "/")}`;
    const ext = path.extname(filePath).toLowerCase();
    const buffer = await readFile(filePath);
    assets[routePath] = {
      contentType: contentTypeForAsset(filePath),
      encoding: textAssetExtensions.has(ext) ? "utf8" : "base64",
      body: textAssetExtensions.has(ext) ? buffer.toString("utf8") : buffer.toString("base64"),
    };
  }

  const generatedDir = path.resolve(artifactDir, "src", "generated");
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    path.join(generatedDir, "client-assets.ts"),
    `export type EmbeddedClientAsset = {
  contentType: string;
  encoding: "utf8" | "base64";
  body: string;
};

export const embeddedClientAssets: Record<string, EmbeddedClientAsset> = ${JSON.stringify(assets)};
`,
  );
}

async function inlineClientEntrypoints(publicDir) {
  const indexPath = path.join(publicDir, "index.html");
  let html = await readFile(indexPath, "utf8");

  html = await replaceAsync(
    html,
    /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/g,
    async (_match, href) => {
      const cssPath = path.join(publicDir, href.replace(/^\//, ""));
      const css = await readFile(cssPath, "utf8");
      return `<style data-webedit-inline="css">\n${css}\n</style>`;
    },
  );

  html = await replaceAsync(
    html,
    /<script type="module" crossorigin src="([^"]+\.js)"><\/script>/g,
    async (_match, src) => {
      const jsPath = path.join(publicDir, src.replace(/^\//, ""));
      const js = (await readFile(jsPath, "utf8")).replace(/<\/script/gi, "<\\/script");
      return `<script type="module" data-webedit-inline="js">\n${js}\n</script>`;
    },
  );

  await writeFile(indexPath, html);
}

async function replaceAsync(value, pattern, replacer) {
  const matches = [...value.matchAll(pattern)];
  const replacements = await Promise.all(matches.map((match) => replacer(...match)));
  let index = 0;
  return value.replace(pattern, () => replacements[index++]);
}

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  const publicDir = path.resolve(artifactDir, "public");
  await rm(distDir, { recursive: true, force: true });
  await rm(publicDir, { recursive: true, force: true });

  const webBuild = spawnSync(
    pnpm,
    ["--filter", "@workspace/webjal-studio", "run", "build"],
    {
      cwd: workspaceDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        NODE_ENV: "production",
        BASE_PATH: process.env.BASE_PATH || "/",
        VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || "",
      },
    },
  );

  if (webBuild.error) throw webBuild.error;
  if (webBuild.status !== 0) {
    throw new Error(`Web app build failed with status ${webBuild.status}`);
  }

  const webPublicDir = path.resolve(webDir, "dist", "public");
  await inlineClientEntrypoints(webPublicDir);
  await cp(webPublicDir, publicDir, { recursive: true });
  await writeEmbeddedClientAssets(webPublicDir);

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/app.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "archiver",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await cp(webPublicDir, path.resolve(distDir, "public"), { recursive: true });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
