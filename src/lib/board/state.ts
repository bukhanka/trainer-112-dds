/**
 * Live board of a lesson: what every place is doing right now, computed from the same rows the
 * workstations write (cards, service plates, status events, calls, attempts). Pure function, so the
 * rules are tested without a database.
 *
 * Card statuses follow the control department of the 112 system:
 *   «Не оповещено» — a service did not open the card within the norm (30 s after «Добавлена»);
 *   «Отказ»        — «Не принята» or «Отказ от выполнения работ»;
 *   «Не завершено» — the lesson is over (or 48 h passed) and a service has not closed the card.
 * These three are shown in red, as on the controller's screen.
 *
 * Time norms of a ДДС place, by the customer's answer of 27.09: 30 s from «Добавлена» to opening the card and
 * 3 min to the first record — a status with a text. Statuses have no other norms: the works may take hours.
 */
import { errorTitle } from "@/lib/scoring/errors";
import { applyOverrides, type CriterionResult, type Overrides } from "@/lib/scoring/score";

export type PlateStatus = "ADDED" | "RECEIVED" | "ACCEPTED" | "REJECTED" | "STARTED" | "ARRIVED" | "WORKING" | "FINISHED" | "REFUSED";

export const PLATE_STATUS_LABEL: Record<PlateStatus, string> = {
  ADDED: "Добавлена",
  RECEIVED: "Получена службой",
  ACCEPTED: "Принята",
  REJECTED: "Не принята",
  STARTED: "Начало реагирования",
  ARRIVED: "Прибытие",
  WORKING: "Проведение работ",
  FINISHED: "Работы завершены",
  REFUSED: "Отказ от выполнения работ",
};

const CLOSED: PlateStatus[] = ["FINISHED", "REFUSED", "REJECTED"];
const ANSWER: PlateStatus[] = ["ACCEPTED", "REJECTED"];
const FINISH_HOURS = 48;

export type BoardInput = {
  lesson: {
    status: "DRAFT" | "RUNNING" | "FINISHED";
    /** generated | students | mixed: in a «generated» lesson cards typed at 112 places do not reach ДДС places. */
    cardSource?: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    ackSec: number;
    workSec: number;
    typingSec: number;
  };
  seats: {
    id: string;
    label: string;
    role: "OP112" | "DDS";
    studentId: string;
    studentName: string;
    serviceId: number | null;
    serviceName: string | null;
    scenarioIds: string[];
    /** The student's level in the role of this place (src/lib/adaptive/rating.ts). */
    level?: SeatLevel | null;
  }[];
  incidents: {
    id: string;
    number: number;
    scenarioId: string | null;
    title: string;
    /** Scenario difficulty 1–10. */
    difficulty?: number | null;
    address: string | null;
    source: string;
    createdBySeatId: string | null;
    /** ДДС place a generated card was sent to (Incident.ddsSeatId of the card flow); null for shared 112 cards. */
    targetSeatId?: string | null;
    createdAt: Date;
    openedAt: Date | null;
    savedAt: Date | null;
    plates: {
      id: string;
      serviceId: number;
      serviceName: string;
      delivery: "ARM112" | "VIS" | "PHONE";
      visible: boolean;
      status: PlateStatus;
      addedAt: Date;
      /** Explicit target place, when the card flow records it. */
      seatId?: string | null;
      events: { status: PlateStatus; at: Date; seatId: string | null; comment?: string | null }[];
    }[];
  }[];
  calls: {
    seatId: string | null;
    kind: string;
    status: "RINGING" | "ACTIVE" | "HELD" | "ENDED" | "MISSED";
    startedAt: Date;
    answeredAt: Date | null;
  }[];
  attempts: {
    seatId: string;
    incidentServiceId: string | null;
    reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
    score: number | null;
    criteria: CriterionResult[];
    override: Overrides | null;
  }[];
};

export type RedFlags = { notNotified: number; refused: number; notFinished: number };

export type SeatLevel = { rating: number; difficulty: number; attempts: number };

export type SeatTimer = {
  phase: "open" | "record" | "brigade" | "typing" | "ringing" | "call";
  label: string;
  since: string; // ISO
  normSec: number | null;
  late: boolean;
};

export type SeatState = {
  id: string;
  label: string;
  role: "OP112" | "DDS";
  studentName: string;
  serviceName: string | null;
  tasks: number;
  level: SeatLevel | null;
  current: { number: number; title: string; address: string | null; status: string; difficulty: number | null } | null;
  timer: SeatTimer | null;
  queue: number;
  counts: { opened: number; answered: number; submitted: number };
  red: RedFlags;
  lateTyping: number;
  missedCalls: number;
  failedChecks: number;
  topErrors: string[];
  pendingReview: number;
  attempts: number;
  avgScore: number | null;
  state: "late" | "working" | "idle";
};

export type CardRow = {
  id: string;
  number: number;
  title: string;
  difficulty: number | null;
  address: string | null;
  createdAt: string;
  source: string;
  author: string | null; // 112 place that typed the card
  control: { label: string; red: boolean }[];
  plates: { name: string; status: string; late: boolean; seat: string | null; phoneOnly: boolean }[];
};

export type BoardState = {
  now: string;
  summary: { seats: number; working: number; lateNow: number; notNotified: number; refused: number; notFinished: number; pendingReview: number; attempts: number };
  seats: SeatState[];
  cards: CardRow[];
};

type Plate = BoardInput["incidents"][number]["plates"][number];
type Incident = BoardInput["incidents"][number];

const secBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;

/** The card opened by the service: the first event after «Добавлена» (normally «Получена службой»). */
function openedAt(plate: Plate): Date | null {
  return plate.events.find((e) => e.status !== "ADDED")?.at ?? null;
}

/** The first record of the service: a status with a text. */
function recordAt(plate: Plate): Date | null {
  return plate.events.find((e) => e.status !== "ADDED" && e.status !== "RECEIVED" && !!e.comment?.trim())?.at ?? null;
}

/** Red control flags of one plate. Phone-only and hidden services do not answer on a workstation. */
export function plateFlags(plate: Plate, input: BoardInput["lesson"], now: Date): RedFlags {
  const flags: RedFlags = { notNotified: 0, refused: 0, notFinished: 0 };
  if (plate.delivery === "PHONE" || !plate.visible) return flags;
  const opened = openedAt(plate);
  const end = input.finishedAt && input.finishedAt < now ? input.finishedAt : now;
  if (opened ? secBetween(plate.addedAt, opened) > input.ackSec : secBetween(plate.addedAt, end) > input.ackSec) flags.notNotified = 1;
  if (plate.status === "REJECTED" || plate.status === "REFUSED" || plate.events.some((e) => e.status === "REFUSED")) flags.refused = 1;
  const over = input.status === "FINISHED" || secBetween(plate.addedAt, now) > FINISH_HOURS * 3600;
  if (over && !CLOSED.includes(plate.status)) flags.notFinished = 1;
  return flags;
}

function sumFlags(list: RedFlags[]): RedFlags {
  return list.reduce((a, f) => ({ notNotified: a.notNotified + f.notNotified, refused: a.refused + f.refused, notFinished: a.notFinished + f.notFinished }), {
    notNotified: 0,
    refused: 0,
    notFinished: 0,
  });
}

/**
 * Which ДДС place a plate belongs to: the place the card was sent to (own service only), then the
 * place that acted on it, then the only place with this service, then the only place with this task.
 * A card typed at a 112 place is shared by every ДДС place of its service until one of them acts.
 */
/**
 * Can this plate reach a ДДС place of the lesson at all? Not when the system already answered it
 * (a bot: answer without a place) and not a card typed at 112 in a lesson that takes only generated cards.
 * The end-of-lesson review follows the same rule (dds/review.ts).
 */
export function reachesPlaces(
  inc: Pick<Incident, "source">,
  p: { events: Pick<Plate["events"][number], "status" | "seatId">[] },
  lesson: Pick<BoardInput["lesson"], "cardSource">,
): boolean {
  if (p.events.some((e) => ANSWER.includes(e.status) && !e.seatId)) return false;
  return !(inc.source === "op112" && lesson.cardSource === "generated");
}

export function assignPlates(input: BoardInput): Map<string, string> {
  const dds = input.seats.filter((s) => s.role === "DDS");
  const ddsIds = new Set(dds.map((s) => s.id));
  const serviceOf = new Map(dds.map((s) => [s.id, s.serviceId]));
  const attemptSeat = new Map(input.attempts.filter((a) => a.incidentServiceId).map((a) => [a.incidentServiceId!, a.seatId]));
  const out = new Map<string, string>();
  for (const inc of input.incidents) {
    for (const p of inc.plates) {
      const target = inc.targetSeatId && serviceOf.get(inc.targetSeatId) === p.serviceId ? inc.targetSeatId : null;
      const explicit = target ?? (p.seatId && ddsIds.has(p.seatId) ? p.seatId : null);
      const acted = p.events.find((e) => e.seatId && ddsIds.has(e.seatId))?.seatId ?? null;
      const graded = attemptSeat.get(p.id);
      let seat = explicit ?? acted ?? (graded && ddsIds.has(graded) ? graded : null);
      if (!seat && reachesPlaces(inc, p, input.lesson)) {
        const byService = dds.filter((s) => s.serviceId === p.serviceId);
        if (byService.length === 1) seat = byService[0].id;
        else if (byService.length > 1 && inc.scenarioId) {
          const byTask = byService.filter((s) => s.scenarioIds.includes(inc.scenarioId!));
          if (byTask.length === 1) seat = byTask[0].id;
        }
      }
      if (seat) out.set(p.id, seat);
    }
  }
  return out;
}

function topFailed(attempts: BoardInput["attempts"]): { failed: number; top: string[] } {
  const counts = new Map<string, number>();
  let failed = 0;
  for (const a of attempts) {
    for (const c of applyOverrides(a.criteria, a.override)) {
      if (c.ok === false) {
        failed++;
        const name = errorTitle(c);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  return { failed, top };
}

export function buildBoard(input: BoardInput, now: Date): BoardState {
  const L = input.lesson;
  const plateSeat = assignPlates(input);
  const running = L.status === "RUNNING";
  const seatLabel = new Map(input.seats.map((s) => [s.id, s.label]));

  const seats: SeatState[] = input.seats.map((seat) => {
    const attempts = input.attempts.filter((a) => a.seatId === seat.id);
    const { failed, top } = topFailed(attempts);
    const scores = attempts.map((a) => a.score).filter((x): x is number => x != null);
    const common = {
      id: seat.id,
      label: seat.label,
      role: seat.role,
      studentName: seat.studentName,
      serviceName: seat.serviceName,
      tasks: seat.scenarioIds.length,
      level: seat.level ?? null,
      failedChecks: failed,
      topErrors: top,
      pendingReview: attempts.filter((a) => a.reviewStatus === "PENDING").length,
      attempts: attempts.length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };

    if (seat.role === "DDS") {
      const byAdded = (a: { p: Plate }, b: { p: Plate }) => a.p.addedAt.getTime() - b.p.addedAt.getTime();
      const mine = input.incidents.flatMap((inc) => inc.plates.filter((p) => plateSeat.get(p.id) === seat.id).map((p) => ({ inc, p }))).sort(byAdded);
      // Shared cards nobody has taken yet wait in the feed of every place of their service.
      const shared = input.incidents
        .flatMap((inc) =>
          inc.plates
            .filter((p) => !plateSeat.has(p.id) && !inc.targetSeatId && p.serviceId === seat.serviceId && inc.savedAt && reachesPlaces(inc, p, L))
            .map((p) => ({ inc, p })),
        )
        .filter(({ p }) => !CLOSED.includes(p.status));
      const open = [...mine.filter(({ p }) => !CLOSED.includes(p.status)), ...shared].sort(byAdded);
      const cur = running ? open[0] : undefined;
      let timer: SeatTimer | null = null;
      if (cur) {
        const since = cur.p.addedAt;
        const elapsed = secBetween(since, now);
        if (!openedAt(cur.p)) timer = { phase: "open", label: "открыть карточку", since: since.toISOString(), normSec: L.ackSec, late: elapsed > L.ackSec };
        else if (!recordAt(cur.p)) timer = { phase: "record", label: "первая запись", since: since.toISOString(), normSec: L.workSec, late: elapsed > L.workSec };
        else timer = { phase: "brigade", label: "работа по карточке", since: since.toISOString(), normSec: null, late: false };
      }
      const red = sumFlags(mine.map(({ p }) => plateFlags(p, L, now)));
      return {
        ...common,
        current: cur
          ? { number: cur.inc.number, title: cur.inc.title, address: cur.inc.address, status: PLATE_STATUS_LABEL[cur.p.status], difficulty: cur.inc.difficulty ?? null }
          : null,
        timer,
        queue: running ? Math.max(0, open.length - (cur ? 1 : 0)) : 0,
        counts: {
          opened: mine.filter(({ p }) => p.events.some((e) => e.status !== "ADDED")).length,
          answered: mine.filter(({ p }) => recordAt(p)).length,
          submitted: mine.filter(({ p }) => CLOSED.includes(p.status)).length,
        },
        red,
        lateTyping: 0,
        missedCalls: 0,
        state: timer?.late ? "late" : cur ? "working" : "idle",
      };
    }

    // 112 place: incoming calls and the cards it types.
    const cards = input.incidents.filter((i) => i.createdBySeatId === seat.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const calls = input.calls.filter((c) => c.seatId === seat.id && c.kind === "CALLER_IN");
    const draft = running ? [...cards].reverse().find((c) => !c.savedAt) : undefined;
    const live = running ? calls.find((c) => c.status === "ACTIVE" || c.status === "RINGING") : undefined;
    let timer: SeatTimer | null = null;
    if (draft) {
      const since = draft.openedAt ?? draft.createdAt;
      timer = { phase: "typing", label: "набор карточки", since: since.toISOString(), normSec: L.typingSec, late: secBetween(since, now) > L.typingSec };
    } else if (live) {
      const since = live.answeredAt ?? live.startedAt;
      timer = { phase: live.status === "RINGING" ? "ringing" : "call", label: live.status === "RINGING" ? "входящий вызов" : "разговор", since: since.toISOString(), normSec: null, late: false };
    }
    const saved = cards.filter((c) => c.savedAt);
    return {
      ...common,
      current: draft ? { number: draft.number, title: draft.title, address: draft.address, status: "заполняется", difficulty: draft.difficulty ?? null } : null,
      timer,
      queue: running ? Math.max(0, calls.filter((c) => c.status === "RINGING").length - (live?.status === "RINGING" ? 1 : 0)) : 0,
      counts: {
        opened: calls.filter((c) => c.answeredAt).length || cards.length,
        answered: saved.length,
        submitted: attempts.length,
      },
      // Control statuses of a card belong to the ДДС places that handle it, not to its author.
      red: { notNotified: 0, refused: 0, notFinished: 0 },
      lateTyping: saved.filter((c) => secBetween(c.openedAt ?? c.createdAt, c.savedAt!) > L.typingSec).length,
      missedCalls: calls.filter((c) => c.status === "MISSED").length,
      state: timer?.late ? "late" : timer ? "working" : "idle",
    };
  });

  const mannedServices = new Set(input.seats.filter((s) => s.role === "DDS" && s.serviceId != null).map((s) => s.serviceId!));
  const cards: CardRow[] = input.incidents
    .map((inc) => {
      // Graded are plates of the lesson's places: taken by a place, or waiting for any place of their service.
      // Services nobody plays are not trainees and never turn a card red.
      const graded = (p: Plate) => plateSeat.has(p.id) || (!inc.targetSeatId && mannedServices.has(p.serviceId) && reachesPlaces(inc, p, L));
      const flagged = inc.plates.map((p) => ({ p, f: graded(p) ? plateFlags(p, L, now) : { notNotified: 0, refused: 0, notFinished: 0 } }));
      const flags = flagged.map((x) => x.f);
      const total = sumFlags(flags);
      const control: CardRow["control"] = [];
      if (total.notNotified) control.push({ label: "Не оповещено", red: true });
      if (total.refused) control.push({ label: "Отказ", red: true });
      if (total.notFinished) control.push({ label: "Не завершено", red: true });
      if (!control.length) {
        const manned = inc.plates.filter(graded);
        if (!inc.savedAt && inc.source === "op112") control.push({ label: "Заполняется", red: false });
        else if (manned.length && manned.every((p) => CLOSED.includes(p.status))) control.push({ label: "Завершена", red: false });
        else control.push({ label: "Зарегистрирована", red: false });
      }
      return {
        id: inc.id,
        number: inc.number,
        title: inc.title,
        difficulty: inc.difficulty ?? null,
        address: inc.address,
        createdAt: inc.createdAt.toISOString(),
        source: inc.source,
        author: inc.createdBySeatId ? (seatLabel.get(inc.createdBySeatId) ?? null) : null,
        control,
        plates: flagged
          .filter(({ p }) => p.visible)
          .map(({ p, f }) => ({
            name: p.serviceName,
            status: PLATE_STATUS_LABEL[p.status],
            late: f.notNotified > 0,
            seat: seatLabel.get(plateSeat.get(p.id) ?? "") ?? null,
            phoneOnly: p.delivery === "PHONE",
          })),
      };
    })
    .sort((a, b) => Number(b.control.some((c) => c.red)) - Number(a.control.some((c) => c.red)) || b.createdAt.localeCompare(a.createdAt));

  const count = (label: string) => cards.filter((c) => c.control.some((x) => x.label === label)).length;
  return {
    now: now.toISOString(),
    summary: {
      seats: seats.length,
      working: seats.filter((s) => s.state !== "idle").length,
      lateNow: seats.filter((s) => s.state === "late").length,
      notNotified: count("Не оповещено"),
      refused: count("Отказ"),
      notFinished: count("Не завершено"),
      pendingReview: seats.reduce((a, s) => a + s.pendingReview, 0),
      attempts: seats.reduce((a, s) => a + s.attempts, 0),
    },
    seats,
    cards,
  };
}
