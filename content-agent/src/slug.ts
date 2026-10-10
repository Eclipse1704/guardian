/** Turns a project name (Hebrew allowed) into a safe directory/file name. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKC")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);
  return slug || "project";
}
