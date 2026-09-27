/** Database side of the teacher corrections (the logic is in corrections.ts). */
import type { Prisma, PrismaClient, SeatRole } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { CriterionResult } from "@/lib/scoring/score";
import { attemptScope, auditInTx } from "@/lib/teacher/access";
import {
  desiredCorrections,
  GUIDANCE_LIMIT,
  learnerOf,
  LEARNING_CHECKS,
  pickGuidance,
  planCorrectionSync,
  switchRefusal,
  type CorrectionContext,
  type GuidanceRow,
} from "./corrections";

type Client = PrismaClient | Prisma.TransactionClient;

export type Situation = CorrectionContext & { role: SeatRole; scenarioTitle: string | null; typeName: string | null };

const firstCode = (raw: unknown): number | null => {
  const list = raw && typeof raw === "object" ? (raw as { typeCodes?: unknown }).typeCodes : null;
  const code = Array.isArray(list) ? list.find((c) => Number.isInteger(c)) : undefined;
  return typeof code === "number" ? code : null;
};

/** The situation of an attempt: its role, scenario and the incident type (the reference one, else the card's). */
export async function attemptSituation(client: Client, attemptId: string): Promise<Situation | null> {
  const a = await client.attempt.findUnique({
    where: { id: attemptId },
    select: {
      kind: true,
      scenarioId: true,
      scenario: { select: { title: true, category: true, truth: true } },
      incident: { select: { typeCodes: true } },
    },
  });
  if (!a) return null;
  const typeCode = firstCode(a.scenario?.truth) ?? a.incident?.typeCodes[0] ?? null;
  const type = typeCode == null ? null : await client.incidentType.findUnique({ where: { code: typeCode }, select: { finalType: true, groupId: true } });
  return {
    role: a.kind,
    scenarioId: a.scenarioId,
    scenarioTitle: a.scenario?.title ?? null,
    category: a.scenario?.category ?? null,
    typeCode,
    typeName: type?.finalType ?? null,
    typeGroupId: type?.groupId ?? null,
  };
}

/** Up to five relevant active corrections for a model check, read at the moment it judges. */
export async function loadGuidance(learner: string, ctx: CorrectionContext, client: Client = db): Promise<GuidanceRow[]> {
  const check = LEARNING_CHECKS.find((c) => c.code === learner);
  if (!check) return [];
  const rows = await client.teacherCorrection.findMany({
    where: { active: true, OR: [{ code: { in: check.reads } }, ...check.prefixes.map((p) => ({ code: { startsWith: p } }))] },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return pickGuidance(ctx, rows, learner, GUIDANCE_LIMIT);
}

export type LearnedItem = {
  id: string;
  title: string;
  typeName: string | null;
  draftOk: boolean | null;
  teacherOk: boolean | null;
  comment: string;
  authorName: string;
  createdAt: Date;
  active: boolean;
};

/** Corrections by id, to show which ones a model check was given. */
export async function correctionsByIds(ids: string[]): Promise<Map<string, LearnedItem>> {
  if (!ids.length) return new Map();
  const rows = await db.teacherCorrection.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, title: true, typeName: true, draftOk: true, teacherOk: true, comment: true, authorName: true, createdAt: true, active: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

const clip = (s: string | null | undefined, max: number) => (s && s.length > max ? `${s.slice(0, max - 1)}…` : (s ?? null));

/**
 * Brings the corrections of an attempt in line with the teacher's decision, in the decision's transaction:
 * new ones are added, those the teacher took back are retired as «revised». Every change goes to the audit.
 */
export async function syncCorrections(
  tx: Prisma.TransactionClient,
  user: SessionUser,
  request: Request,
  input: { attemptId: string; criteria: CriterionResult[]; next: { reviewStatus: string; override: Record<string, boolean | null> | null; teacherComment: string | null } },
): Promise<{ created: number; retired: number }> {
  const desired = desiredCorrections(input.next);
  if (!desired) return { created: 0, retired: 0 };
  const active = await tx.teacherCorrection.findMany({
    where: { attemptId: input.attemptId, active: true },
    select: { id: true, code: true, teacherOk: true, comment: true },
  });
  const plan = planCorrectionSync(active, desired);
  const now = new Date();
  for (const id of plan.retire) {
    await tx.teacherCorrection.update({ where: { id }, data: { active: false, offAt: now, offById: user.id, offByName: user.fullName, offReason: "revised" } });
    await auditInTx(tx, user, request, { action: "correction.revise", entity: "TeacherCorrection", entityId: id, before: { active: true }, after: { active: false, reason: "revised" } });
  }
  let created = 0;
  if (plan.create.length) {
    const where = await attemptSituation(tx, input.attemptId);
    const byCode = new Map(input.criteria.map((c) => [c.code, c]));
    for (const d of plan.create) {
      const c = byCode.get(d.code);
      if (!c || !where) continue;
      const row = await tx.teacherCorrection.create({
        data: {
          attemptId: input.attemptId,
          authorId: user.id,
          authorName: user.fullName,
          role: where.role,
          code: c.code,
          title: c.title,
          group: c.group,
          source: c.source,
          scenarioId: where.scenarioId,
          scenarioTitle: where.scenarioTitle,
          category: where.category,
          typeCode: where.typeCode,
          typeName: where.typeName,
          typeGroupId: where.typeGroupId,
          draftOk: c.ok,
          draftEvidence: clip(c.evidence, 600),
          teacherOk: d.teacherOk,
          comment: d.comment,
        },
      });
      await auditInTx(tx, user, request, {
        action: "correction.add",
        entity: "TeacherCorrection",
        entityId: row.id,
        after: { attemptId: input.attemptId, code: c.code, draftOk: c.ok, teacherOk: d.teacherOk, comment: d.comment },
      });
      created++;
    }
  }
  return { created, retired: plan.retire.length };
}

// ─── The «Учёт правок» page ──────────────────────────────────────────────────

export type CorrectionFilter = { state?: string; role?: string; mine?: boolean };

export type CorrectionListItem = {
  id: string;
  createdAt: Date;
  authorName: string;
  mine: boolean;
  /** The viewer may switch it (author or administrator). */
  canSwitch: boolean;
  role: SeatRole;
  code: string;
  title: string;
  source: string;
  /** The model check that reads it (self — the correction is of that very check), or null: a rule nobody reads. */
  learner: { title: string; self: boolean } | null;
  scenarioTitle: string | null;
  typeName: string | null;
  draftOk: boolean | null;
  draftEvidence: string | null;
  teacherOk: boolean | null;
  comment: string;
  active: boolean;
  offReason: string | null;
  offByName: string | null;
  offAt: Date | null;
  /** In how many model checks it was shown. */
  used: number;
  /** Only when the viewer may open that attempt (own lesson, or an administrator). */
  attemptId: string | null;
};

export type CorrectionList = {
  items: CorrectionListItem[];
  stats: { active: number; learning: number; used: number; off: number };
  /** Rule checks the teachers correct most often: rules do not learn, this is a hint for the methodologist. */
  rules: { code: string; title: string; count: number; learner: string | null }[];
};

/**
 * All corrections of the centre, newest first: the methodology is shared by the teachers. Nothing about
 * students is shown, and the link to the attempt only to those who may open it.
 */
function learnerFor(code: string): CorrectionListItem["learner"] {
  const l = learnerOf(code);
  return l ? { title: l.title, self: l.code === code } : null;
}

export async function listCorrections(user: SessionUser, f: CorrectionFilter = {}): Promise<CorrectionList> {
  const where: Prisma.TeacherCorrectionWhereInput = {};
  if (f.state === "active") where.active = true;
  if (f.state === "off") where.active = false;
  if (f.role === "OP112" || f.role === "DDS") where.role = f.role;
  if (f.mine) where.authorId = user.id;
  const [rows, counts, used] = await Promise.all([
    db.teacherCorrection.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 }),
    db.teacherCorrection.findMany({ where: { active: true }, select: { code: true, title: true, source: true } }),
    db.$queryRaw<{ id: string; n: bigint | number }[]>`
      SELECT l.id AS id, count(*) AS n
      FROM "Attempt" a
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.criteria) = 'array' THEN a.criteria ELSE '[]'::jsonb END) AS c
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'learned') = 'array' THEN c->'learned' ELSE '[]'::jsonb END) AS l(id)
      GROUP BY l.id`,
  ]);
  const usedBy = new Map(used.map((u) => [u.id, Number(u.n)]));
  const attemptIds = [...new Set(rows.flatMap((r) => (r.attemptId ? [r.attemptId] : [])))];
  const open = attemptIds.length
    ? new Set((await db.attempt.findMany({ where: { id: { in: attemptIds }, ...attemptScope(user) }, select: { id: true } })).map((a) => a.id))
    : new Set<string>();

  const byRule = new Map<string, { code: string; title: string; count: number; learner: string | null }>();
  for (const c of counts) {
    if (c.source !== "rule") continue;
    const e = byRule.get(c.code) ?? { code: c.code, title: c.title, count: 0, learner: learnerOf(c.code)?.title ?? null };
    e.count++;
    byRule.set(c.code, e);
  }
  return {
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      authorName: r.authorName,
      mine: r.authorId === user.id,
      canSwitch: !switchRefusal(user, r, !r.active),
      role: r.role,
      code: r.code,
      title: r.title,
      source: r.source,
      learner: learnerFor(r.code),
      scenarioTitle: r.scenarioTitle,
      typeName: r.typeName,
      draftOk: r.draftOk,
      draftEvidence: r.draftEvidence,
      teacherOk: r.teacherOk,
      comment: r.comment,
      active: r.active,
      offReason: r.offReason,
      offByName: r.offByName,
      offAt: r.offAt,
      used: usedBy.get(r.id) ?? 0,
      attemptId: r.attemptId && open.has(r.attemptId) ? r.attemptId : null,
    })),
    stats: {
      active: counts.length,
      learning: counts.filter((c) => learnerOf(c.code)).length,
      used: [...usedBy.values()].reduce((a, b) => a + b, 0),
      off: await db.teacherCorrection.count({ where: { active: false } }),
    },
    rules: [...byRule.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}
