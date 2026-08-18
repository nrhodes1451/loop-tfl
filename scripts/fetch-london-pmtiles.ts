/**
 * Extract a Greater London PMTiles archive from a public Protomaps basemap.
 * Writes gitignored data/osm/london.pmtiles (HTTP range extract — does not
 * download the whole planet).
 *
 * Usage: npm run fetch-london-pmtiles
 * Optional: PMTILES_SOURCE=https://... npm run fetch-london-pmtiles
 *            (defaults to the latest daily planet at build.protomaps.com)
 * Optional: PMTILES_BIN=/path/to/pmtiles if the CLI is already installed
 */

import { spawn } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Greater London, lon/lat. */
const BBOX = "-0.55,51.25,0.35,51.72";

const BUILD_HOST = "https://build.protomaps.com";

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Latest daily planet at build.protomaps.com, walking back a few days. */
async function resolveSource(): Promise<string> {
  if (process.env.PMTILES_SOURCE) return process.env.PMTILES_SOURCE;
  const now = Date.now();
  for (let i = 0; i < 10; i++) {
    const stamp = ymd(new Date(now - i * 86_400_000));
    const url = `${BUILD_HOST}/${stamp}.pmtiles`;
    const res = await fetch(url, { method: "HEAD" });
    if (res.ok) return url;
  }
  throw new Error(
    `No Protomaps daily build found at ${BUILD_HOST}. Set PMTILES_SOURCE.`,
  );
}

const CLI_VERSION = "1.31.2";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

function whichPmtiles(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("pmtiles", ["--help"], { stdio: "ignore" });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code === 0 ? "pmtiles" : null));
  });
}

function releaseAsset(): { dir: string; archive: string } {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === "linux" && arch === "x64") {
    return { dir: "Linux_x86_64", archive: `go-pmtiles_${CLI_VERSION}_Linux_x86_64.tar.gz` };
  }
  if (plat === "linux" && arch === "arm64") {
    return { dir: "Linux_arm64", archive: `go-pmtiles_${CLI_VERSION}_Linux_arm64.tar.gz` };
  }
  if (plat === "darwin" && arch === "arm64") {
    return {
      dir: "Darwin_arm64",
      archive: `go-pmtiles_${CLI_VERSION}_Darwin_arm64.tar.gz`,
    };
  }
  if (plat === "darwin" && arch === "x64") {
    return {
      dir: "Darwin_x86_64",
      archive: `go-pmtiles_${CLI_VERSION}_Darwin_x86_64.tar.gz`,
    };
  }
  throw new Error(
    `No go-pmtiles build for ${plat}/${arch}. Install the CLI from https://github.com/protomaps/go-pmtiles/releases and set PMTILES_BIN.`,
  );
}

async function cachedCli(): Promise<string> {
  const cacheDir = path.join(
    process.cwd(),
    "node_modules",
    ".cache",
    "go-pmtiles",
  );
  const binPath = path.join(cacheDir, "pmtiles");
  const existing = spawn(binPath, ["--help"], { stdio: "ignore" });
  const ok = await new Promise<boolean>((resolve) => {
    existing.on("error", () => resolve(false));
    existing.on("exit", (code) => resolve(code === 0));
  });
  if (ok) return binPath;

  const { archive } = releaseAsset();
  const url = `https://github.com/protomaps/go-pmtiles/releases/download/v${CLI_VERSION}/${archive}`;
  await mkdir(cacheDir, { recursive: true });
  const tmp = path.join(os.tmpdir(), archive);
  console.log(`Downloading ${url}`);
  await run("curl", ["-fsSL", "-o", tmp, url]);
  await run("tar", ["-xzf", tmp, "-C", cacheDir, "pmtiles"]);
  await chmod(binPath, 0o755);
  return binPath;
}

async function resolveCli(): Promise<string> {
  if (process.env.PMTILES_BIN) return process.env.PMTILES_BIN;
  const onPath = await whichPmtiles();
  if (onPath) return onPath;
  return cachedCli();
}

async function main() {
  const source = await resolveSource();
  const outDir = path.join(process.cwd(), "data", "osm");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "london.pmtiles");
  const cli = await resolveCli();
  console.log(`Extracting bbox ${BBOX}`);
  console.log(`Source ${source}`);
  console.log(`Dest   ${outPath}`);
  await run(cli, ["extract", source, outPath, `--bbox=${BBOX}`]);
  console.log(`Wrote ${outPath}`);
}

const isCli = process.argv[1]?.includes("fetch-london-pmtiles");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
