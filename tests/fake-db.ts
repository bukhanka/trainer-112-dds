/**
 * A tiny in-memory stand-in for the Prisma client, enough to test that route handlers filter rows by
 * the current user. It understands equality, { in }, { not } and nested relation objects in `where`.
 */
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === null) return value == null; // a field the fixture leaves out is null, as in the database
    if (cond && typeof cond === "object" && !Array.isArray(cond) && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("not" in c) return value !== c.not;
      if ("equals" in c) return value === c.equals;
      return value !== null && typeof value === "object" && matches(value as Row, c);
    }
    return value === cond;
  });
}

export function fakeModel(rows: Row[]) {
  return {
    findMany: async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r, where)),
    findFirst: async ({ where }: { where?: Where } = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where?: Where } = {}) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: { where?: Where } = {}) => rows.filter((r) => matches(r, where)).length,
  };
}
