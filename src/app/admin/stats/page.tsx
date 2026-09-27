import { DailyColumns, type ColumnSeries } from "@/components/charts";
import { usageStats, type DayStats } from "@/lib/admin/stats";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";

const DAYS = 14;
const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export default async function StatsPage() {
  await requireUser(["ADMIN"]);
  const stats = await usageStats(DAYS);
  const { days, totals, inSystem } = stats;
  const axis = days.map((d) => {
    const date = new Date(`${d.day}T12:00:00+03:00`);
    return { key: d.day, label: String(date.getUTCDate()), title: `${formatDate(date)}, ${WEEKDAY[date.getUTCDay()]}` };
  });
  const series = (name: string, tone: ColumnSeries["tone"], pick: (d: DayStats) => number): ColumnSeries => ({ name, tone, values: days.map(pick) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">Статистика использования</h1>
        <span className="text-xs text-arm-desc">
          последние {DAYS} дней, {formatDate(`${days[0].day}T12:00:00+03:00`)} — {formatDate(`${days[days.length - 1].day}T12:00:00+03:00`)}, московское время
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Входов в систему" value={totals.logins} note={`разных людей за период — ${stats.activeUsers}`} />
        <Tile label="Занятий начато / завершено" value={`${totals.lessonsStarted} / ${totals.lessonsFinished}`} note={`самостоятельных тренировок — ${totals.practices}`} />
        <Tile label="Попыток / подтверждено" value={`${totals.attempts} / ${totals.confirmed}`} note="подтверждает преподаватель" />
        <Tile label="Обращений к моделям ИИ" value={totals.aiCalls} note={`по правилам вместо модели — ${totals.aiRules}, сбоев — ${totals.aiFailed}`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Chart title="Входы и активные пользователи">
          <DailyColumns label="Входы и активные пользователи" days={axis} series={[series("Входы", "blue", (d) => d.logins), series("Активные пользователи", "green", (d) => d.activeUsers)]} />
        </Chart>
        <Chart title="Занятия">
          <DailyColumns
            label="Занятия"
            days={axis}
            series={[series("Начато", "blue", (d) => d.lessonsStarted), series("Завершено", "green", (d) => d.lessonsFinished), series("Самостоятельные тренировки", "gray", (d) => d.practices)]}
          />
        </Chart>
        <Chart title="Попытки обучающихся">
          <DailyColumns label="Попытки" days={axis} series={[series("Сделано", "blue", (d) => d.attempts), series("Подтверждено преподавателем", "green", (d) => d.confirmed)]} />
        </Chart>
        <Chart title="Модели ИИ">
          <DailyColumns
            label="Модели ИИ"
            days={axis}
            series={[series("Обращения к моделям", "blue", (d) => d.aiCalls), series("Ответы по правилам", "amber", (d) => d.aiRules), series("Сбои", "red", (d) => d.aiFailed)]}
          />
        </Chart>
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <caption className="px-3 pt-2 text-left text-xs text-arm-desc">По дням — точные числа</caption>
          <thead className="bg-arm-panel text-left text-xs text-arm-desc">
            <tr>
              <th className="p-2">День</th>
              <th className="p-2 text-right">Входы</th>
              <th className="p-2 text-right">Активные</th>
              <th className="p-2 text-right">Занятий начато</th>
              <th className="p-2 text-right">завершено</th>
              <th className="p-2 text-right">Тренировки</th>
              <th className="p-2 text-right">Попытки</th>
              <th className="p-2 text-right">Подтверждено</th>
              <th className="p-2 text-right">Обращения к моделям</th>
              <th className="p-2 text-right">По правилам</th>
              <th className="p-2 text-right">Сбои</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[...days].reverse().map((d, i) => (
              <tr key={d.day} className="border-t">
                <td className="whitespace-nowrap p-2">{axis[days.length - 1 - i].title}</td>
                {[d.logins, d.activeUsers, d.lessonsStarted, d.lessonsFinished, d.practices, d.attempts, d.confirmed, d.aiCalls, d.aiRules, d.aiFailed].map((n, j) => (
                  <td key={j} className={`p-2 text-right ${n ? "" : "text-arm-gray"}`}>
                    {n}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t bg-arm-panel font-semibold">
              <td className="p-2">Всего</td>
              {[totals.logins, stats.activeUsers, totals.lessonsStarted, totals.lessonsFinished, totals.practices, totals.attempts, totals.confirmed, totals.aiCalls, totals.aiRules, totals.aiFailed].map((n, j) => (
                <td key={j} className="p-2 text-right">
                  {n}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <section className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">Всего в системе сейчас</h2>
        <p>
          Пользователей {inSystem.users} (обучающихся {inSystem.students}, преподавателей {inSystem.teachers}) · групп {inSystem.groups} · занятий{" "}
          {inSystem.lessons} · попыток {inSystem.attempts} · утверждённых сценариев {inSystem.scenarios}
        </p>
      </section>

      <section className="text-xs text-arm-desc">
        <h2 className="mb-1 font-semibold text-arm-dark">Как считается</h2>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Входы — успешные входы из журнала аудита. Активные пользователи — разные люди, которые в этот день что-то делали в системе (вход, действие в журнале, попытка); «Всего» — разные люди за весь период.</li>
          <li>Занятия — по времени старта и окончания; самостоятельные тренировки обучающихся считаются отдельно. Попытки — по времени создания, подтверждения — по времени решения преподавателя.</li>
          <li>
            Обращения к моделям — запросы к языковой модели, распознаванию и синтезу речи. Ответы по правилам — модель была нужна, но ответили правила: модели выключены или
            не подключены, исчерпан лимит, модель недавно сбоила. Сбои — модель спросили, но она не ответила или ответила неверно; работу доделали правила.
          </li>
          <li>
            Счётчики моделей каждый процесс сервера записывает раз в минуту, поэтому последняя минута может ещё не войти.{" "}
            {stats.countersSince ? `Счётчики ведутся с ${formatDate(`${stats.countersSince}T12:00:00+03:00`)}.` : "Обращений к моделям ещё не было."}
          </li>
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="rounded border bg-white p-3">
      <div className="text-xs text-arm-desc">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-arm-desc">{note}</div>
    </div>
  );
}

function Chart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border bg-white p-3">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
