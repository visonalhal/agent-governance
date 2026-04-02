import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function readText(filePath: string) {
  return fs.readFile(filePath, "utf8");
}

export async function writeText(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readText(filePath)) as T;
}

export async function writeJsonFile(filePath: string, value: unknown) {
  await writeText(filePath, stableJson(value));
}

export async function readYamlFile<T>(filePath: string): Promise<T> {
  return YAML.parse(await readText(filePath)) as T;
}

export async function writeYamlFile(filePath: string, value: unknown) {
  const serialized = YAML.stringify(value, {
    defaultStringType: "PLAIN",
    indent: 2,
    lineWidth: 100,
    minContentWidth: 0,
  });
  await writeText(filePath, serialized);
}

export function normalizePosix(value: string) {
  return value.split(path.sep).join("/");
}

export function stableJson(value: unknown) {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return Object.fromEntries(entries.map(([key, inner]) => [key, sortDeep(inner)]));
  }

  return value;
}

export async function listFiles(targetDir: string, suffix: string) {
  if (!(await pathExists(targetDir))) {
    return [];
  }
  const dirents = await fs.readdir(targetDir, { withFileTypes: true });
  return dirents
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => path.join(targetDir, entry.name))
    .sort();
}

export async function removePath(targetPath: string) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function copyDirectory(sourceDir: string, targetDir: string) {
  await ensureDir(path.dirname(targetDir));
  await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
}

export async function copyFile(sourceFile: string, targetFile: string) {
  await ensureDir(path.dirname(targetFile));
  await fs.copyFile(sourceFile, targetFile);
}

export async function computeDirectoryDigest(sourcePath: string) {
  const hash = createHash("sha256");
  const stat = await fs.stat(sourcePath);

  if (stat.isFile()) {
    hash.update(await fs.readFile(sourcePath));
    return hash.digest("hex");
  }

  const files = await walkFiles(sourcePath);
  for (const filePath of files) {
    const relativePath = normalizePosix(path.relative(sourcePath, filePath));
    hash.update(relativePath);
    hash.update(await fs.readFile(filePath));
  }

  return hash.digest("hex");
}

export function computeValueDigest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export async function listTopLevelEntries(targetDir: string) {
  if (!(await pathExists(targetDir))) {
    return [];
  }

  const dirents = await fs.readdir(targetDir, { withFileTypes: true });
  return dirents
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(targetDir, entry.name),
      kind: entry.isDirectory() ? "directory" : "file",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function copyDirectoryResolved(sourceDir: string, targetDir: string) {
  await ensureDir(path.dirname(targetDir));
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (entryPath) => {
      const name = path.basename(entryPath);
      return name !== ".git" && name !== ".DS_Store";
    },
  });
}

export async function listAbsoluteSymlinks(targetPath: string) {
  if (!(await pathExists(targetPath))) {
    return [];
  }

  const collected: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const stat = await fs.lstat(currentPath);
    if (stat.isSymbolicLink()) {
      const linkTarget = await fs.readlink(currentPath);
      if (path.isAbsolute(linkTarget)) {
        collected.push(currentPath);
      }
      return;
    }

    if (!stat.isDirectory()) {
      return;
    }

    const dirents = await fs.readdir(currentPath, { withFileTypes: true });
    const sorted = [...dirents].sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of sorted) {
      await walk(path.join(currentPath, entry.name));
    }
  }

  await walk(targetPath);
  return collected;
}

async function walkFiles(rootDir: string): Promise<string[]> {
  const collected: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const dirents = await fs.readdir(currentDir, { withFileTypes: true });
    const sorted = [...dirents].sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sorted) {
      const nextPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
        continue;
      }
      if (entry.isFile()) {
        collected.push(nextPath);
      }
    }
  }

  await walk(rootDir);
  return collected;
}
