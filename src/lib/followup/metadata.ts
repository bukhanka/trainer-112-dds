import { z } from "zod";

export const skillKeySchema = z.enum(["op112.location", "dds.report_record"]);
export const learningMetaSchema = z.object({
  purpose: z.enum(["practice", "control"]),
  role: z.enum(["OP112", "DDS"]),
  skillKeys: z.array(skillKeySchema).min(1).max(2),
  equivalenceKey: z.string().trim().min(1).max(80),
  caseKey: z.string().trim().min(1).max(80),
});
export type LearningMeta = z.infer<typeof learningMetaSchema>;
export const learningMeta = (raw: unknown): LearningMeta | null => learningMetaSchema.safeParse(raw).data ?? null;
export const isControl = (raw: unknown): boolean => learningMeta(raw)?.purpose === "control";
