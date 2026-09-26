import { db } from "@/lib/db";
import { matchType, readByRules } from "@/lib/scenarios/generate";
(async () => {
  const types = await db.incidentType.findMany({ select: { code: true, groupId: true, finalType: true, sign1: true, sign2: true, sign3: true, questions: true, hiddenFromOperator: true } });
  const scen = await db.scenario.findMany({ where: { source: "ticket" } });
  let ok = 0, okA = 0, nA = 0;
  for (const s of scen) {
    const caller = s.caller as { situation: string; visibleAddress: string };
    const truth = s.truth as { finalType: string; acceptableTypeCodes?: number[]; typeCodes: number[] };
    if (!truth.finalType) continue;
    const text = `${caller.situation} ${caller.visibleAddress}`;
    const ex = readByRules(text);
    const m = matchType(types, ex.typeHint, text);
    const good = !!m && ((truth.acceptableTypeCodes ?? truth.typeCodes).includes(m.code) || m.finalType === truth.finalType);
    if (good) ok++;
    if (s.status === "APPROVED") { nA++; if (good) okA++; else console.log(`✗ ${s.ticketRef}: ${m?.finalType ?? "—"} | эталон: ${truth.finalType}`); }
  }
  console.log(`утверждённые: ${okA} из ${nA}; все билеты: ${ok} из ${scen.length}`);
  await db.$disconnect();
})();
