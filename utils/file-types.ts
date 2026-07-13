export function isJSONFile(file: Pick<File, "name" | "type">): boolean {
  return file.name.trim().toLowerCase().endsWith(".json")
    || file.type.toLowerCase().includes("json");
}
