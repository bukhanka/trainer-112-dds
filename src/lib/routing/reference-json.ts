/**
 * Routing reference read straight from data/*.json — for tests, scripts and the seed,
 * where the database may be empty. Server-only (uses the file system).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { referenceFromJson, type ClassifierJson, type RoutingReference, type ServicesJson } from "./engine";

export const DATA_DIR = path.join(process.cwd(), "data");

export function readDataJson<T>(name: string, dir = DATA_DIR): T {
  return JSON.parse(readFileSync(path.join(dir, name), "utf8")) as T;
}

let cached: RoutingReference | null = null;

export function loadJsonReference(dir = DATA_DIR): RoutingReference {
  if (cached && dir === DATA_DIR) return cached;
  const reference = referenceFromJson(
    readDataJson<ClassifierJson>("classifier.json", dir),
    readDataJson<ServicesJson>("services.json", dir),
  );
  if (dir === DATA_DIR) cached = reference;
  return reference;
}
