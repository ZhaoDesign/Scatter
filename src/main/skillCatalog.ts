import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SkillCatalogItem } from "../shared/types";

interface SkillRoot {
  path: string;
  source: SkillCatalogItem["source"];
}

const catalogCache = new Map<string, { expiresAt: number; skills: SkillCatalogItem[] }>();
const cacheDurationMs = 15_000;

function parseFrontmatterValue(frontmatter: string, key: string): string {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(frontmatter);
  return match?.[1]?.trim().replace(/^(?:['"])(.*)(?:['"])$/, "$1") || "";
}

async function parseSkillFile(filePath: string, source: SkillCatalogItem["source"]): Promise<SkillCatalogItem | null> {
  try {
    const content = await readFile(filePath, "utf8");
    const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] || "";
    const name = parseFrontmatterValue(frontmatter, "name") || path.basename(path.dirname(filePath));
    const description = parseFrontmatterValue(frontmatter, "description");
    return name ? { name, description, source } : null;
  } catch {
    return null;
  }
}

async function addSkillDirectory(directory: string, source: SkillCatalogItem["source"], output: SkillCatalogItem[]): Promise<void> {
  const directFile = path.join(directory, "SKILL.md");
  const skill = await parseSkillFile(directFile, source);
  if (skill) output.push(skill);
}

async function scanSkillsRoot(root: SkillRoot, output: SkillCatalogItem[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(root.path, { withFileTypes: true });
  } catch {
    return;
  }

  await addSkillDirectory(root.path, root.source, output);
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => addSkillDirectory(path.join(root.path, entry.name), root.source, output)));
}

export async function listSkills(projectPath: string, forceRefresh = false): Promise<SkillCatalogItem[]> {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex");
  const roots: SkillRoot[] = [
    { path: path.join(projectPath, ".agents", "skills"), source: "project" },
    { path: path.join(homedir(), ".agents", "skills"), source: "codex" },
    { path: path.join(codexHome, "skills"), source: "codex" }
  ];
  const cacheKey = roots.map((root) => root.path).join("\n");
  const cached = catalogCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.skills;

  const discovered: SkillCatalogItem[] = [];
  for (const root of roots) await scanSkillsRoot(root, discovered);
  const unique = new Map<string, SkillCatalogItem>();
  for (const skill of discovered) {
    const key = skill.name.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, skill);
  }
  const skills = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  catalogCache.set(cacheKey, { expiresAt: Date.now() + cacheDurationMs, skills });
  return skills;
}
