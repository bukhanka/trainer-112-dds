"use client";
import useSWR from "swr";
import { plural } from "@/lib/format";
import { errorTitle } from "@/lib/scoring/errors";
import { timePointsLine, WEIGHT_GROUPS, type CriterionResult, type WeightGroup } from "@/lib/scoring/score";
import { getJson } from "./client";
import { Modal } from "./Services";
import { IconCheck, IconClose } from "./icons";

type ReviewData =
  | { ready: false }
  // A lesson: the draft waits for the teacher, the student sees nothing of it.
  | { ready: true; hidden: true; reviewStatus: string }
  | {
      ready: true;
      hidden?: false;
      /** «Тренировка без занятия»: the automatic review is a self-check, not a mark. */
      selfCheck?: boolean;
      score: number | null;
      criteria: CriterionResult[];
      overrides: Record<string, boolean | null> | null;
      /** Where the points of a late time check reach zero, in norms (src/lib/scoring/score.ts). */
      timeZeroAt?: number;
      ai: string;
      reviewStatus: string;
      teacherComment: string | null;
      scenarioTitle: string | null;
      ticketRef: string | null;
      reference: {
        cards: string[];
        finalType: string | null;
        address: string;
        services: string[];
        questions: string[];
        traps: string[];
        empty?: string | null;
      } | null;
    };

const AI_NOTE: Record<string, string> = {
  pending: "ИИ-проверка разговора выполняется…",
  done: "ИИ-проверка разговора выполнена.",
  failed: "ИИ-проверка не удалась — остались проверки по правилам.",
  off: "Модель не настроена: проверки по правилам, ИИ-пункты не учитываются.",
  empty: "Пустая карточка: проверки по правилам, ИИ-проверка разговора не нужна.",
};

export function ReviewModal(p: { incidentId: string; number: number | null; onClose: () => void; nextLabel?: string }) {
  const { data } = useSWR<ReviewData>(`/api/op112/incidents/${p.incidentId}/review`, getJson, {
    refreshInterval: (d) => (!d || !d.ready || (!d.hidden && d.ai === "pending") ? 2500 : 0),
  });
  const hidden = data?.ready && data.hidden;
  const ready = data?.ready && !data.hidden ? data : null;
  const criteria = ready ? applyOverrides(ready.criteria, ready.overrides) : [];
  // «Балл за время — 49 %…» for a late time check, by the draft check and the teacher's corrections.
  const timeLines = new Map(
    (ready?.criteria ?? []).flatMap((c) => {
      const line = timePointsLine(c, { timeZeroAt: ready?.timeZeroAt }, ready?.overrides);
      return line ? [[c.code, line] as const] : [];
    }),
  );
  const said = criteria.filter((c) => c.code.startsWith("op112.said.") || c.code === "op112.ai.said");
  const rest = criteria.filter((c) => !said.includes(c));
  const fix = criteria.filter((c) => c.ok === false).sort((a, b) => Number(Boolean(b.critical)) - Number(Boolean(a.critical)));
  const groups = (Object.keys(WEIGHT_GROUPS) as WeightGroup[])
    .map((g) => ({ g, items: rest.filter((c) => c.group === g) }))
    .filter((x) => x.items.length);

  return (
    <Modal
      title={`Разбор вызова${p.number ? ` · Происшествие ${p.number}` : ""}`}
      onClose={p.onClose}
      width="max-w-[980px]"
      footer={
        <button type="button" autoFocus onClick={p.onClose} className="bg-arm-blue px-6 py-2.5 text-[15px] font-semibold text-white hover:brightness-95">
          {p.nextLabel ?? "Закрыть"}
        </button>
      }
    >
      {hidden ? (
        <div className="px-5 py-10 text-center text-[15px] text-arm-dark">
          Карточка сохранена. Разбор появится после проверки преподавателем — в разделе «Мои результаты».
        </div>
      ) : !ready ? (
        <div className="px-5 py-10 text-center text-arm-desc">Проверяем карточку…</div>
      ) : (
        <div className="flex flex-col gap-5 px-5 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <ScoreBadge score={ready.score} />
            <div className="min-w-0 flex-1 text-[13.5px] text-arm-desc">
              {ready.scenarioTitle && (
                <div className="text-[15px] font-semibold text-arm-dark">
                  {ready.scenarioTitle}
                  {ready.ticketRef ? ` · билет ${ready.ticketRef}` : ""}
                </div>
              )}
              <div>{AI_NOTE[ready.ai] ?? ""}</div>
              <div>
                {ready.reviewStatus !== "PENDING"
                  ? "Оценку подтвердил преподаватель."
                  : ready.selfCheck
                    ? "Самопроверка тренировки — не оценка: оценку ставит преподаватель на занятии."
                    : "Оценка предварительная: её подтверждает преподаватель."}
              </div>
              {ready.teacherComment && <div className="mt-1 text-arm-dark">Комментарий преподавателя: {ready.teacherComment}</div>}
            </div>
          </div>

          {fix.length > 0 && (
            <section className="border-l-4 border-arm-late bg-[#fff3f1] px-4 py-3">
              <h3 className="mb-1 text-[15px] font-bold text-arm-dark">Что исправить ({fix.length})</h3>
              <ul className="list-disc pl-5 text-[13.5px] text-arm-dark">
                {fix.slice(0, 8).map((c) => (
                  <li key={c.code}>
                    {c.critical && <b className="text-arm-late">Критично: </b>}
                    {errorTitle(c)}
                    {c.expected ? ` — надо: ${c.expected}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {said.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[15px] font-bold text-arm-dark">Сказал ↔ заполнил</h3>
              <p className="mb-2 text-[12.5px] text-arm-desc">Всё, что заявитель сообщил в разговоре, должно быть в карточке.</p>
              <CriteriaList items={said} notes={timeLines} />
            </section>
          )}

          {groups.map(({ g, items }) => (
            <section key={g}>
              <h3 className="mb-1.5 text-[15px] font-bold text-arm-dark">{WEIGHT_GROUPS[g]}</h3>
              <CriteriaList items={items} notes={timeLines} />
            </section>
          ))}

          {ready.reference && (
            <section className="border-t border-[#dde1e3] pt-3 text-[13.5px]">
              <h3 className="mb-1.5 text-[15px] font-bold text-arm-dark">Эталон</h3>
              {ready.reference.empty ? (
                <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1">
                  <dt className="text-arm-desc">Верное действие</dt>
                  <dd>{ready.reference.empty}</dd>
                </dl>
              ) : (
                <dl className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-1">
                  <dt className="text-arm-desc">Тип</dt>
                  <dd>
                    {ready.reference.cards.join(", ") || "—"}
                    {ready.reference.finalType ? ` · Класс.: ${ready.reference.finalType}` : ""}
                  </dd>
                  <dt className="text-arm-desc">Адрес</dt>
                  <dd>{ready.reference.address || "—"}</dd>
                  <dt className="text-arm-desc">Службы</dt>
                  <dd>{ready.reference.services.join(", ") || "—"}</dd>
                  <dt className="text-arm-desc">Обязательные вопросы</dt>
                  <dd>{ready.reference.questions.join("; ") || "—"}</dd>
                  {ready.reference.traps.length > 0 && (
                    <>
                      <dt className="text-arm-desc">Ловушки задания</dt>
                      <dd>{ready.reference.traps.join("; ")}</dd>
                    </>
                  )}
                </dl>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function applyOverrides(list: CriterionResult[], overrides: Record<string, boolean | null> | null): CriterionResult[] {
  if (!overrides) return list;
  return list.map((c) => (c.code in overrides ? { ...c, ok: overrides[c.code] } : c));
}

export function ScoreBadge({ score }: { score: number | null }) {
  const tone = score === null ? "bg-[#9aa3a9]" : score >= 80 ? "bg-[#1c8a3a]" : score >= 60 ? "bg-[#d98b00]" : "bg-arm-late";
  return (
    <div className={`flex h-[72px] w-[92px] shrink-0 flex-col items-center justify-center text-white ${tone}`}>
      <div className="text-[30px] font-bold leading-none">{score ?? "—"}</div>
      <div className="mt-1 text-[11px]">{score === null ? "баллов" : plural(score, ["балл", "балла", "баллов"])} из 100</div>
    </div>
  );
}

const RANK = (c: CriterionResult) => (c.ok === false ? 0 : c.ok === null ? 2 : 1);

function CriteriaList({ items, notes }: { items: CriterionResult[]; notes?: Map<string, string> }) {
  return (
    <ul className="divide-y divide-[#eceef0] border border-[#e3e6e8]">
      {[...items].sort((a, b) => RANK(a) - RANK(b)).map((c) => (
        <li key={c.code} className="flex gap-3 px-3 py-2">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-white ${c.ok === null ? "bg-[#b6bdc2]" : c.ok ? "bg-[#1c8a3a]" : "bg-arm-late"}`}
            aria-label={c.ok === null ? "не применимо" : c.ok ? "верно" : "ошибка"}
          >
            {c.ok === null ? "–" : c.ok ? <IconCheck className="h-3.5 w-3.5" /> : <IconClose className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0 flex-1 text-[13.5px]">
            <div className="font-semibold text-arm-dark">
              {c.title}
              {c.critical && c.ok === false && <span className="ml-2 bg-arm-late px-1.5 py-0.5 text-[11px] font-bold text-white">критично</span>}
              {c.source === "ai" && <span className="ml-2 border border-[#c9ced1] px-1 text-[10.5px] font-normal text-arm-desc">ИИ</span>}
            </div>
            {c.evidence && <div className="text-arm-desc">{c.evidence}</div>}
            {notes?.get(c.code) && <div className="text-[#8a5a00]">{notes.get(c.code)}</div>}
            {c.expected && c.ok === false && <div className="text-arm-dark">Надо: {c.expected}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
