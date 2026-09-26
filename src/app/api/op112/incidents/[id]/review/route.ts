import { db } from "@/lib/db";
import { jsonError, op112User, ownIncident } from "@/lib/op112/access";
import { kindTitle } from "@/lib/op112/catalog";
import { normalizeTruth } from "@/lib/op112/evaluate";
import { addressLine } from "@/lib/op112/gazetteer";
import { activeWeights, loadEvalInput } from "@/lib/op112/review";
import { serviceCatalog } from "@/lib/op112/services";
import { computeScore, type CriterionResult, type Overrides } from "@/lib/scoring/score";

// Review of the student's own saved card: checks with evidence, score by the active weights, the reference answer.
export async function GET(_req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/review">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  const attempt = await db.attempt.findFirst({ where: { incidentId: id, kind: "OP112" }, orderBy: { createdAt: "desc" } });
  if (!attempt) return Response.json({ ready: false });

  const criteria = (attempt.criteria ?? []) as unknown as CriterionResult[];
  const overrides = (attempt.override ?? null) as Overrides | null;
  const score = computeScore(criteria, await activeWeights(), overrides);
  const scenario = own.incident.scenarioId ? await db.scenario.findUnique({ where: { id: own.incident.scenarioId } }) : null;
  const catalog = await serviceCatalog();
  const truth = normalizeTruth(scenario?.truth, catalog);
  const loaded = truth ? await loadEvalInput(id) : null;
  const reference = truth
    ? {
        cards: truth.kind ? [kindTitle(truth.kind)] : [],
        finalType: truth.finalType ?? null,
        address: [addressLine(truth.address), truth.address.district ? `${truth.address.okrug ?? ""} ${truth.address.district}`.trim() : ""]
          .filter(Boolean)
          .join(" — "),
        services: (loaded?.input.expectedServices ?? truth.services).map((sid) => catalog.find((c) => c.id === sid)?.shortName ?? `#${sid}`),
        questions: truth.requiredQuestions.map((q) => q.text),
        traps: truth.traps,
      }
    : null;
  return Response.json({
    ready: true,
    score,
    criteria,
    overrides,
    ai: (attempt.aiDraft as { status?: string } | null)?.status ?? "off",
    reviewStatus: attempt.reviewStatus,
    teacherComment: attempt.teacherComment,
    scenarioTitle: scenario?.title ?? null,
    ticketRef: scenario?.ticketRef ?? null,
    reference,
  });
}
