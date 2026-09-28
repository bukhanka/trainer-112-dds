/**
 * Reference data from data/*.json: classifier groups and types, routing cells, services,
 * and training scenarios built from the customer's tickets and from the operator's instruction.
 * Idempotent: types, groups and services are upserted, routes are replaced as a whole,
 * scenarios are matched by their reference («Б1-1», «НВ-1»).
 */
import type { Prisma, PrismaClient, ServiceDelivery, ScenarioStatus } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DATA = path.join(__dirname, "..", "data");

type ClassifierFile = {
  groups: { id: number; name: string }[];
  types: {
    code: number;
    groupId: number;
    subgroup: string | null;
    sign1: string | null;
    sign2: string | null;
    sign3: string | null;
    extra: string | null;
    questions: string[];
    finalType: string;
    ekpType: string | null;
    mainService: string | null;
    scenarioCode: string | null;
    hiddenFromOperator: boolean;
    routes: [string, string, string][];
  }[];
};

type ServiceFile = {
  id: number;
  shortName: string;
  fullName: string | null;
  kind: string;
  subtype: string | null;
  classifierCol: string | null;
  routeKeys: string[];
  delivery: ServiceDelivery;
  visible: boolean;
  okrug: string | null;
  district: string | null;
  selectRule: string | null;
  phone: string | null;
  orderIdx: number;
  mainCodes: string[];
}[];

type ScenarioFile = {
  ticketRef: string;
  /** ticket (the customer's tickets, the default) | instruction (tasks written from the operator's instruction) */
  source?: string;
  title: string;
  category: string;
  difficulty: number;
  status: ScenarioStatus;
  caller: Prisma.InputJsonValue;
  truth: Prisma.InputJsonValue;
  ddsCard?: Prisma.InputJsonValue | null;
  ddsReference?: Prisma.InputJsonValue | null;
  approvedSections?: string[];
  teacherNote?: string | null;
}[];

function read<T>(name: string): T | null {
  const file = path.join(DATA, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function seedClassifier(db: PrismaClient, classifier: ClassifierFile) {
  for (const g of classifier.groups) {
    await db.incidentGroup.upsert({ where: { id: g.id }, update: { name: g.name }, create: { id: g.id, name: g.name } });
  }

  const typeData = classifier.types.map((t) => ({
    code: t.code,
    groupId: t.groupId,
    subgroup: t.subgroup,
    sign1: t.sign1,
    sign2: t.sign2,
    sign3: t.sign3,
    extra: t.extra,
    questions: t.questions,
    finalType: t.finalType,
    ekpType: t.ekpType,
    mainService: t.mainService,
    scenarioCode: t.scenarioCode,
    hiddenFromOperator: t.hiddenFromOperator,
  }));
  const existing = new Set((await db.incidentType.findMany({ select: { code: true } })).map((t) => t.code));
  const fresh = typeData.filter((t) => !existing.has(t.code));
  if (fresh.length) await db.incidentType.createMany({ data: fresh });
  for (const part of chunks(typeData.filter((t) => existing.has(t.code)), 250)) {
    await db.$transaction(part.map(({ code, ...rest }) => db.incidentType.update({ where: { code }, data: rest })));
  }
  const codes = typeData.map((t) => t.code);
  await db.route.deleteMany({});
  await db.incidentType.deleteMany({ where: { code: { notIn: codes } } });

  const routes = classifier.types.flatMap((t) =>
    t.routes.map(([routeKey, condition, label]) => ({ typeCode: t.code, routeKey, condition, label })),
  );
  for (const part of chunks(routes, 5000)) await db.route.createMany({ data: part });
  return { groups: classifier.groups.length, types: typeData.length, routes: routes.length };
}

async function seedServices(db: PrismaClient, services: ServiceFile) {
  await db.$transaction(
    services.map((s) => {
      const data = {
        shortName: s.shortName,
        fullName: s.fullName,
        kind: s.kind,
        subtype: s.subtype,
        classifierCol: s.classifierCol,
        routeKeys: s.routeKeys,
        delivery: s.delivery,
        visible: s.visible,
        okrug: s.okrug,
        district: s.district,
        selectRule: s.selectRule,
        phone: s.phone,
        orderIdx: s.orderIdx,
        mainCodes: s.mainCodes,
      };
      return db.service.upsert({ where: { id: s.id }, update: data, create: { id: s.id, ...data } });
    }),
  );
  return services.length;
}

async function seedScenarios(db: PrismaClient, scenarios: ScenarioFile) {
  const existing = await db.scenario.findMany({
    where: { source: { in: ["ticket", "instruction"] }, ticketRef: { not: null } },
    select: { id: true, ticketRef: true },
  });
  const byRef = new Map(existing.map((s) => [s.ticketRef, s.id]));
  let created = 0;
  for (const s of scenarios) {
    const data = {
      title: s.title,
      category: s.category,
      difficulty: s.difficulty,
      status: s.status,
      source: s.source ?? "ticket",
      ticketRef: s.ticketRef,
      caller: s.caller,
      truth: s.truth,
      ddsCard: s.ddsCard ?? undefined,
      ddsReference: s.ddsReference ?? undefined,
      approvedSections: s.approvedSections ?? [],
      teacherNote: s.teacherNote ?? null,
    };
    const id = byRef.get(s.ticketRef);
    if (id) await db.scenario.update({ where: { id }, data });
    else {
      await db.scenario.create({ data });
      created++;
    }
  }
  return { total: scenarios.length, created };
}

export async function seedReference(db: PrismaClient): Promise<void> {
  const started = Date.now();
  const classifier = read<ClassifierFile>("classifier.json");
  const services = read<ServiceFile>("services.json");
  // Variants of approved tickets with an error in the card (a customer requirement): the crew reports it on arrival.
  const scenarios = [...(read<ScenarioFile>("scenarios.json") ?? []), ...(read<ScenarioFile>("scenarios-card-errors.json") ?? [])];

  const parts: string[] = [];
  if (classifier) {
    const c = await seedClassifier(db, classifier);
    parts.push(`${c.groups} groups, ${c.types} types, ${c.routes} routes`);
  }
  if (services) parts.push(`${await seedServices(db, services)} services`);
  if (scenarios.length) {
    const s = await seedScenarios(db, scenarios);
    parts.push(`${s.total} scenarios from tickets and the instruction (${s.created} new)`);
  }
  console.log(`seed-reference: ${parts.join(", ") || "no data files"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
