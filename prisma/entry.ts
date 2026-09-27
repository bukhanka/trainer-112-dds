/**
 * True when this file is the program being run — `pnpm exec tsx prisma/seed.ts` or `node dist/seed.js` —
 * and not when it is bundled into another script: in one esbuild bundle `require.main === module` holds
 * for every bundled file, so demo-reset would start the seeds' own runs in parallel with itself.
 */
export function isEntry(name: string): boolean {
  return new RegExp(`(^|[\\\\/])${name}\\.(ts|js)$`).test(process.argv[1] ?? "");
}
