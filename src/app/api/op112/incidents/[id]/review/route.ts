import { db } from "@/lib/db";
import { jsonError, op112User, ownIncident } from "@/lib/op112/access";
import { kindTitle } from "@/lib/op112/catalog";
import { normalizeTruth } from "@/lib/op112/evaluate";
import { addressLine } from "@/lib/op112/gazetteer";
import { activeWeights, aiState, loadEvalInput } from "@/lib/op112/review";
import { isSelfTraining } from "@/lib/op112/seat";
import { serviceCatalog } from "@/lib/op112/services";
import { computeScore, timeZeroAt, type CriterionResult, type Overrides } from "@/lib/scoring/score";

const EMPTY_ANSWER = {
  noContact: "«нет контакта» → «сохранить карточку как пустую»: контакта с заявителем не было, службы не оповещаются",
  dropped: "«срыв звонка» → «сохранить карточку как пустую»: звонок сорвался раньше, чем заявитель что-то сообщил",
} as const;

/**
 * Review of the student's own saved card: checks with evidence, score by the active weights, the reference answer.
 * In a lesson the draft is the teacher's to confirm: until then the student learns only that the card is saved —
 * no score, no checks, no reference (other places may still be working on the same task). In «Тренировка без
 * занятия» the automatic review is shown at once as a self-check.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/review">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  const attempt = await db.attempt.findFirst({ where: { incidentId: id, seatId: own.seat.id, kind: "OP112" }, orderBy: { createdAt: "desc" } });
  if (!attempt) return Response.json({ ready: false });
  const selfCheck = isSelfTraining(own.seat.lesson.settings);
  if (!selfCheck && attempt.reviewStatus === "PENDING") return Response.json({ ready: true, hidden: true, reviewStatus: attempt.reviewStatus });

  const criteria = (attempt.criteria ?? []) as unknown as CriterionResult[];
  const isEmpty = own.incident.status === "empty";
  const overrides = (attempt.override ?? null) as Overrides | null;
  const weights = await activeWeights();
  const score = computeScore(criteria, weights, overrides);
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
        // A call that brought nothing: the right answer is a button, not a card.
        empty: truth.emptyCall ? EMPTY_ANSWER[truth.emptyCall] : null,
      }
    : null;
  return Response.json({
    ready: true,
    score,
    criteria,
    overrides,
    // Where the points of a late time check reach zero, in norms: the review line «Балл за время — 49 %…».
    timeZeroAt: timeZeroAt(weights),
    // An empty card has no conversation to read: the model checks are not needed, whether a model is set or not.
    ai: isEmpty ? "empty" : attempt.incidentId ? aiState(criteria) : "off",
    reviewStatus: attempt.reviewStatus,
    selfCheck,
    teacherComment: attempt.teacherComment,
    scenarioTitle: scenario?.title ?? null,
    // Only the customer's tickets are «билеты»; the tasks written from the instruction have their own codes.
    ticketRef: scenario?.source === "ticket" ? scenario.ticketRef : null,
    reference,
  });
}
