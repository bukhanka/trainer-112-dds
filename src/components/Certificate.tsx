/**
 * «Сертификат о прохождении занятия»: one A4 sheet turned sideways. On screen it is a card with «Печать / PDF»; the
 * browser prints it or saves it as PDF without the cabinet menu. Who may open it is checked by the page
 * (src/lib/reports/certificate.ts, loadCertificate).
 */
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { PrintPage } from "@/components/PrintPage";
import { countLabel, formatDate, shortName } from "@/lib/format";
import { passedWord, type CertificateData } from "@/lib/reports/certificate";
import { describePassRules } from "@/lib/scoring/pass";

const ROLE = { OP112: "оператор 112", DDS: "диспетчер ДДС" } as const;

export function CertificateView({ data, back }: { data: CertificateData; back: { href: string; label: string } }) {
  const v = data.verdict;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PrintPage landscape />
      {/* On paper only the certificate: one A4 sheet. */}
      <div className={v.ok ? "print:hidden" : ""}>
        <PageHeader
          back={back}
          title="Сертификат о прохождении занятия"
          subtitle={`${data.studentName} · «${data.lessonTitle}»${data.date ? ` · ${formatDate(data.date)}` : ""}`}
          actions={v.ok ? <PrintButton label="🖨 Печать / PDF" /> : undefined}
        />
      </div>
      {v.ok ? (
        <>
          <p className="text-sm text-arm-desc print:hidden">
            «Печать / PDF» открывает печать браузера: выберите принтер или «Сохранить как PDF» — сертификат уместится на один лист A4 (альбомная ориентация).
          </p>
          <Certificate data={data} score={v.score} passed={v.passed} />
        </>
      ) : (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Сертификата по этому занятию нет: {v.reason} Сертификат выдаётся, когда занятие завершено, преподаватель проверил все попытки ученика и все они
          зачтены по критериям занятия ({describePassRules(data.rules)}).
        </p>
      )}
    </div>
  );
}

function Certificate({ data, score, passed }: { data: CertificateData; score: number; passed: number }) {
  return (
    <article
      aria-label="Сертификат"
      className="relative mx-auto flex w-full max-w-[980px] flex-col border-[6px] border-double border-arm-blue bg-white px-5 py-6 text-center text-arm-dark shadow-sm sm:aspect-[297/210] sm:px-[6%] sm:py-[4.5%] print:aspect-auto print:h-[184mm] print:max-w-none print:px-[14mm] print:py-[10mm] print:shadow-none"
    >
      <div className="text-[13px] uppercase tracking-[0.2em] text-arm-desc">Тренажёр 112 / ДДС</div>
      <h2 className="mt-3 text-[28px] font-bold uppercase leading-none tracking-[0.12em] text-arm-blue sm:text-[46px] sm:tracking-[0.18em] print:text-[46px] print:tracking-[0.18em]">
        Сертификат
      </h2>
      <div className="mt-2 text-[17px]">о прохождении практического занятия</div>

      <div className="mt-6 text-[15px] text-arm-desc">Настоящим подтверждается, что</div>
      <div className="mt-2 border-b border-arm-gray pb-1 text-[28px] font-semibold leading-tight">{data.studentName}</div>
      <div className="mt-3 text-[15px]">
        {passedWord(data.studentName)} практическое занятие <b>«{data.lessonTitle}»</b>
      </div>
      <div className="mt-1 text-[15px]">
        в роли: {ROLE[data.role]}
        {data.serviceName ? `, служба «${data.serviceName}»` : ""}
        {data.groupName ? ` · ${data.groupName}` : ""}
      </div>

      <dl className="mx-auto mt-6 grid w-full max-w-[720px] grid-cols-1 gap-3 text-[14px] sm:grid-cols-3 print:grid-cols-3">
        <div className="rounded border border-arm-gray/80 px-2 py-2">
          <dt className="text-[12px] text-arm-desc">Дата занятия</dt>
          <dd className="text-[18px] font-semibold tabular-nums">{formatDate(data.date)}</dd>
        </div>
        <div className="rounded border border-arm-gray/80 px-2 py-2">
          <dt className="text-[12px] text-arm-desc">Итоговый балл</dt>
          <dd className="text-[18px] font-semibold tabular-nums">{score} из 100</dd>
        </div>
        <div className="rounded border border-arm-gray/80 px-2 py-2">
          <dt className="text-[12px] text-arm-desc">Зачтено попыток</dt>
          <dd className="text-[18px] font-semibold tabular-nums">
            {passed} из {passed}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[12.5px] text-arm-desc">
        Критерии зачёта занятия: {describePassRules(data.rules)}.{" "}
        {passed === 1 ? "Попытка проверена преподавателем." : `Все ${countLabel(passed, ["попытка", "попытки", "попыток"])} проверены преподавателем.`}
      </p>

      <div className="mt-auto flex flex-wrap items-end justify-between gap-6 pt-6 text-left text-[14px]">
        <div>
          <div className="text-[12px] text-arm-desc">Преподаватель</div>
          <div className="mt-6 flex items-end gap-3">
            <span className="inline-block w-44 border-b border-arm-dark" aria-hidden />
            <span className="font-medium">{shortName(data.teacherName)}</span>
          </div>
        </div>
        <div className="text-right text-[12.5px] text-arm-desc">
          <div>
            № <span className="font-mono text-arm-dark">{data.number}</span>
          </div>
          {data.issuedAt && <div>Выдан {formatDate(data.issuedAt)}</div>}
        </div>
      </div>
    </article>
  );
}
