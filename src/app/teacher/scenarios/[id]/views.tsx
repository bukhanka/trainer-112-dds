/**
 * Readable views of scenario sections in the format of data/scenarios.json. The reference data is
 * written by different hands, so every field is optional and unknown shapes fall back to raw JSON.
 */
import type { ReactNode } from "react";
import { formatAddress } from "@/lib/board/address";
import { PLATE_STATUS_LABEL, type PlateStatus } from "@/lib/board/state";
import { TEMPERS } from "@/lib/scenarios/sections";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown) => list(v).map(str).filter((x): x is string => !!x);

const FLAG_LABEL: Record<string, string> = {
  victims: "пострадавшие",
  victimsAbsent: "пострадавшие не на месте",
  refusedAmbulance: "отказ от скорой",
  noAccess: "нет доступа",
  blocked: "заблокированные",
  threat: "угроза людям",
  med: "нужна медпомощь",
  evac: "эвакуация",
  gas: "газифицирован",
  offense: "правонарушение",
  traffic: "перекрытие движения",
  tunnel: "тоннель",
  crossing: "пешеходный переход",
  crowd: "больше 5 человек",
  construction: "стройка",
  objectList: "объект из перечня",
  comm: "объект связи",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "" || (Array.isArray(children) && !children.length)) return null;
  return (
    <>
      <dt className="text-arm-desc">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Chips({ items, tone = "neutral" }: { items: ReactNode[]; tone?: "neutral" | "blue" | "amber" | "green" }) {
  const cls = { neutral: "bg-arm-panel", blue: "bg-arm-blue/10 text-arm-dark", amber: "bg-amber-100 text-amber-900", green: "bg-emerald-50 text-emerald-900" }[tone];
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x, i) => (
        <span key={i} className={`rounded px-1.5 py-0.5 text-xs ${cls}`}>
          {x}
        </span>
      ))}
    </span>
  );
}

function Flags({ flags }: { flags: unknown }) {
  if (!isObj(flags)) return null;
  const on = Object.entries(flags)
    .filter(([, v]) => v === true)
    .map(([k]) => FLAG_LABEL[k] ?? k);
  return on.length ? <Chips items={on} tone="amber" /> : <span className="text-arm-desc">нет</span>;
}

export function RawJson({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto rounded bg-arm-panel p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

export function CallerView({ value }: { value: unknown }) {
  if (!isObj(value)) return <RawJson value={value} />;
  const facts = strings(value.facts);
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      <Row label="Заявитель">
        <b>{str(value.fullName)}</b>
        {str(value.role) && <>, {str(value.role)}</>}
        {str(value.phone) && <span className="text-arm-desc"> · {str(value.phone)}</span>}
      </Row>
      <Row label="Характер, голос">{[TEMPERS[str(value.temper) ?? ""] ?? str(value.temper), value.voice === "male" ? "мужской голос" : value.voice === "female" ? "женский голос" : null].filter(Boolean).join(", ")}</Row>
      <Row label="Говорит сразу">
        <span className="block">«{str(value.situation)}»</span>
        <span className="block text-arm-desc">Адрес: «{str(value.visibleAddress)}»</span>
      </Row>
      <Row label="Только если спросить">{str(value.hiddenAddress) && <span className="rounded bg-emerald-50 px-1 text-emerald-900">{str(value.hiddenAddress)}</span>}</Row>
      <Row label="Факты">
        {facts.length ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : null}
      </Row>
    </dl>
  );
}

export function TruthView({ value }: { value: unknown }) {
  if (!isObj(value)) return <RawJson value={value} />;
  const services = list(value.services);
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      <Row label="Тип">
        <b>{str(value.finalType) ?? "—"}</b>
        {str(value.kind) && <span className="text-arm-desc"> · опросная карта {str(value.kind)}</span>}
        {list(value.typeCodes).length > 0 && <span className="text-xs text-arm-desc"> · коды {list(value.typeCodes).join(", ")}</span>}
      </Row>
      <Row label="Теги">{strings(value.tags).length ? <Chips items={strings(value.tags)} tone="blue" /> : null}</Row>
      <Row label="Признаки">
        <Flags flags={value.flags} />
      </Row>
      <Row label="Адрес">{str(value.addressLine) ?? formatAddress(value.address)}</Row>
      <Row label="Службы">
        {services.length ? (
          <span className="flex flex-wrap gap-1">
            {services.map((s, i) => {
              const name = isObj(s) ? (str(s.shortName) ?? str(s.service) ?? `служба ${str(s.serviceId)}`) : str(s);
              const main = isObj(s) && s.isMain === true;
              return (
                <span key={i} title={isObj(s) ? (str(s.reason) ?? undefined) : undefined} className={`rounded px-1.5 py-0.5 text-xs ${main ? "bg-arm-dark text-white" : "bg-arm-panel"}`}>
                  {name}
                </span>
              );
            })}
          </span>
        ) : null}
      </Row>
      <Row label="Обязательные вопросы">
        {strings(value.requiredQuestions).length ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {strings(value.requiredQuestions).map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        ) : null}
      </Row>
      <Row label="Ловушки">
        {strings(value.traps).length ? (
          <ul className="space-y-0.5">
            {strings(value.traps).map((q) => (
              <li key={q} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
                ⚠ {q}
              </li>
            ))}
          </ul>
        ) : null}
      </Row>
    </dl>
  );
}

export function DdsCardView({ value }: { value: unknown }) {
  if (!isObj(value)) return <RawJson value={value} />;
  const caller = isObj(value.caller) ? value.caller : {};
  return (
    <div className="overflow-hidden rounded border border-arm-dark/40 text-sm">
      <div className="flex flex-wrap items-center gap-2 bg-arm-dark px-3 py-1.5 text-white">
        <span className="font-semibold">Класс.: {str(value.classLabel) ?? str(value.type) ?? "—"}</span>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 bg-arm-panel/60 p-3">
        <Row label="Теги">{str(value.tagsLine)}</Row>
        <Row label="Адрес">
          {str(value.address)}
          {str(value.descriptive) && <span className="block text-arm-desc">{str(value.descriptive)}</span>}
        </Row>
        <Row label="Описание">{str(value.description)}</Row>
        <Row label="Заявитель">{[str(caller.fullName), str(caller.status), str(caller.aon)].filter(Boolean).join(", ")}</Row>
        <Row label="Признаки">
          <Flags flags={value.flags} />
        </Row>
        <Row label="Службы">{strings(value.services).length ? <Chips items={strings(value.services)} /> : null}</Row>
      </dl>
    </div>
  );
}

const DECISION: Record<string, { label: string; cls: string }> = {
  ACCEPTED: { label: "Принять", cls: "bg-emerald-700 text-white" },
  accept: { label: "Принять", cls: "bg-emerald-700 text-white" },
  REJECTED: { label: "Не принимать", cls: "bg-red-600 text-white" },
  reject: { label: "Не принимать", cls: "bg-red-600 text-white" },
  OPEN: { label: "Решение не оценивается", cls: "bg-slate-500 text-white" },
  open: { label: "Решение не оценивается", cls: "bg-slate-500 text-white" },
};

/** Reference actions of a ДДС with the right moves highlighted: decision, status chain, what to write, traps. */
export function DdsReferenceView({ value }: { value: unknown }) {
  if (!isObj(value)) return <RawJson value={value} />;
  const entries: { name: string; e: Obj }[] = Array.isArray(value.services)
    ? value.services.filter(isObj).map((e) => ({ name: str(e.service) ?? `служба ${str(e.serviceId)}`, e }))
    : Object.entries(isObj(value.services) ? value.services : value)
        .filter(([k, v]) => k !== "rules" && isObj(v))
        .map(([name, e]) => ({ name, e: e as Obj }));
  const rules = strings(value.rules);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {rules.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-arm-desc">
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {entries.map(({ name, e }) => {
        const d = DECISION[str(e.decision) ?? ""];
        const chain = strings(e.chain).map((s) => PLATE_STATUS_LABEL[s as PlateStatus] ?? s);
        return (
          <div key={name} className="rounded border border-arm-gray/70 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <b>{name}</b>
              {d && <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${d.cls}`}>{d.label}</span>}
            </div>
            {chain.length > 0 && (
              <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
                {chain.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-arm-desc">→</span>}
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-900">{c}</span>
                  </span>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              <Row label="Комментарий к решению">{str(e.decisionComment)}</Row>
              <Row label="Доклад наряда">{str(e.brigadeReport) === "—" ? null : str(e.brigadeReport)}</Row>
              <Row label="В комментарии должно быть">{strings(e.commentMustHave ?? e.mustMention).length ? <Chips items={strings(e.commentMustHave ?? e.mustMention)} tone="green" /> : null}</Row>
              <Row label="Ловушки">
                {strings(e.traps).length ? (
                  <ul className="space-y-0.5">
                    {strings(e.traps).map((t) => (
                      <li key={t} className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
                        ⚠ {t}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Row>
            </dl>
          </div>
        );
      })}
      {!entries.length && !rules.length && <RawJson value={value} />}
    </div>
  );
}
