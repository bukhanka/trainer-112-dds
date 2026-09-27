/**
 * «Справка» of a trainee: a printable memo for the ДДС and 112 places. Statuses, norms and shortcuts are
 * read from the code that enforces them (status machine, lesson defaults, the 112 key handler), so the
 * memo cannot drift away from the workstations.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { ServiceStatus } from "@prisma/client";
import { RING_SEC } from "@/lib/dds/calls";
import { REPORT_REACT_SEC } from "@/lib/dds/crew";
import { allowedNext, NO_CREW_COMMENT, STATUS_LABEL } from "@/lib/dds/status";
import { plural } from "@/lib/format";
import { OP112_KEYS } from "@/lib/help/op112-keys";
import { defaultTeacherSettings } from "@/lib/lessons/defaults";
import { CRITICAL_CAP, WEIGHT_GROUPS } from "@/lib/scoring/score";
import { PrintButton } from "./PrintButton";

/** When each status is set, in the words of the dispatcher memo. */
const WHEN: Record<ServiceStatus, { who: "система" | "вы"; when: string }> = {
  ADDED: { who: "система", when: "карточка пришла на ваше место — с этой минуты идут нормативы" },
  RECEIVED: { who: "система", when: "вы впервые открыли карточку" },
  ACCEPTED: { who: "вы", when: "реагирование будет. Сразу укажите номер наряда, если отправляете его" },
  REJECTED: { who: "вы", when: "происшествие не ваше. Обязательно: причина и кому передано" },
  STARTED: { who: "вы", when: "старший наряда доложил о выезде" },
  ARRIVED: { who: "вы", when: "наряд доложил, что прибыл на место" },
  WORKING: { who: "вы", when: "наряд доложил, что начал работы" },
  FINISHED: { who: "вы", when: "наряд закончил. Итоги — в комментарий: после сохранения карточка закроется для вашей службы" },
  REFUSED: { who: "вы", when: "работы не проводились. Причина и кому передано; карточка закроется" },
};

/** Rows of «сейчас → можно поставить», straight from the status machine. */
const STEPS: ServiceStatus[][] = [["ADDED", "RECEIVED"], ["REJECTED"], ["ACCEPTED"], ["STARTED"], ["ARRIVED"], ["WORKING"], ["FINISHED", "REFUSED"]];

const q = (s: ServiceStatus) => `«${STATUS_LABEL[s]}»`;

/** 30 → «30 секунд», 180 → «3 минуты», 65 → «1 минута 5 секунд»; `after` gives «через 1 минуту». */
function inWords(total: number, after = false): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  const min: [string, string, string] = [after ? "минуту" : "минута", "минуты", "минут"];
  const sec: [string, string, string] = [after ? "секунду" : "секунда", "секунды", "секунд"];
  const parts = [m ? `${m} ${plural(m, min)}` : "", s ? `${s} ${plural(s, sec)}` : ""];
  return parts.filter(Boolean).join(" ") || "0 секунд";
}

function Block({ id, title, newSheet, children }: { id: string; title: string; newSheet?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-4 rounded border border-arm-gray/70 bg-white p-4 print:border-0 print:p-0 ${newSheet ? "print:break-before-page" : ""}`}>
      <h2 className="mb-3 text-lg font-semibold text-arm-dark">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-1 font-semibold text-arm-dark">{children}</h3>;
}

const table = "w-full border-collapse text-sm print:text-[12px] [&_td]:border-t [&_td]:border-arm-gray/60 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:text-arm-desc";

export async function TraineeMemo() {
  const norms = await defaultTeacherSettings();
  const ack = inWords(norms.ackSec);
  const work = inWords(norms.workSec);
  const typing = inWords(norms.typingSec);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 print:max-w-none print:gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-arm-dark">Справка: как работать на тренажёре</h1>
          <p className="mt-0.5 text-sm text-arm-desc">
            Памятка для места диспетчера ДДС и места оператора 112. Нормативы — те, что заданы в центре по умолчанию; на занятии преподаватель может задать другие, они
            видны на рабочем месте.
          </p>
        </div>
        <PrintButton />
      </div>

      <nav aria-label="Разделы справки" className="flex flex-wrap gap-x-4 gap-y-1 text-sm print:hidden">
        <a href="#dds" className="text-arm-blue hover:underline">
          Место ДДС
        </a>
        <a href="#op112" className="text-arm-blue hover:underline">
          Место 112
        </a>
        <a href="#voice" className="text-arm-blue hover:underline">
          Разговор голосом
        </a>
        <a href="#score" className="text-arm-blue hover:underline">
          Как ставится оценка
        </a>
      </nav>

      <Block id="dds" title="Место диспетчера ДДС">
        <H3>Два норматива</H3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>{ack}</b> — на ответ «Принята» или «Не принята». Время считается с «Добавлена» у вашей службы, даже если карточка ещё ждёт в очереди. Таймер в ленте
            краснеет, когда время вышло.
          </li>
          <li>
            <b>{work}</b> — на отработку карточки: после «Принята» отправьте наряд (номер наряда в статусе или звонок наряду) либо закройте карточку. Отсчёт тоже от
            «Добавлена». Таймер с песочными часами в ленте и в карточке показывает, сколько осталось на отработку, и краснеет, когда время вышло.
          </li>
        </ul>

        <H3>Статусы и когда их ставить</H3>
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr>
                <th>Статус</th>
                <th>Когда ставить</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(WHEN) as ServiceStatus[]).map((s) => (
                <tr key={s} className="break-inside-avoid">
                  <td className="w-[38%] font-medium sm:w-auto sm:whitespace-nowrap">
                    {STATUS_LABEL[s]}
                    {WHEN[s].who === "система" && <span className="block text-xs font-normal text-arm-desc">ставит система</span>}
                  </td>
                  <td>{WHEN[s].when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H3>Порядок статусов</H3>
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr>
                <th>Сейчас</th>
                <th>Можно поставить</th>
              </tr>
            </thead>
            <tbody>
              {STEPS.map((now) => {
                const next = allowedNext(now[0], { noReject: false });
                return (
                  <tr key={now.join()} className="break-inside-avoid">
                    <td className="font-medium">{now.map(q).join(" или ")}</td>
                    <td>{next.length ? next.map(q).join(", ") : "ничего: карточка закрыта для вашей службы, ошибку исправляет отдел контроля — сообщите по телефону"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5">
          <li>Назад по статусам не ходят. Промежуточные статусы хода работ можно пропустить, но только если наряд о них не докладывал.</li>
          <li>
            Служба 103 не ставит {q("REJECTED")} и {q("REFUSED")}: вместо них — {q("FINISHED")} с комментарием «{NO_CREW_COMMENT}», прямо с первого ответа.
          </li>
          <li>Статусы ставятся по факту: {q("ARRIVED")} — после доклада о прибытии, а не заранее.</li>
        </ul>

        <H3>Что писать в комментарии</H3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            {q("REJECTED")} и {q("REFUSED")}: причина словами (чья это зона ответственности, почему реагировать не будете) и <b>кому передано</b> — организация и сам
            факт передачи: «передано в …», «дубль карточки …», «КП № …».
          </li>
          <li>
            {q("FINISHED")}: итоги — что сделано, что устранено, кому передано. Не «выполнено» и не «готово»: следующий диспетчер должен понять, что было на месте.
          </li>
          <li>Статусы хода работ — коротко, что делает наряд.</li>
          <li>
            Статус и комментарий должны говорить одно и то же: «Принята: не обслуживаем» — ошибка, это {q("REJECTED")}; «Работы завершены: работы не проводились» —
            ошибка, это {q("REFUSED")}.
          </li>
        </ul>

        <H3>Телефон</H3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Кнопка «Телефон» — справа внизу; при входящем звонке телефон открывается сам.</li>
          <li>Наряд назначается номером наряда в статусе («Принята», наряд 23) или звонком: наберите свободный наряд из книжки и скажите адрес и что случилось.</li>
          <li>
            Старший наряда звонит сам на каждом этапе. Звонок ждёт {inWords(RING_SEC, true)} и становится пропущенным — это ошибка в разборе. Пропустили — перезвоните наряду
            сами.
          </li>
          <li>После доклада наряда поставьте статус не позже чем через {inWords(REPORT_REACT_SEC, true)}.</li>
          <li>Перезвон заявителю — трубка у номера в карточке. Номер карточки заявителю не называйте.</li>
          <li>
            «Удержание» — собеседник подождёт на линии, а вы примете доклад наряда или позвоните в другую службу. Жёлтая полоса показывает, сколько он ждёт; «Снять с
            удержания» — вернуться к нему. Не забывайте про того, кто ждёт: через 3 минуты он положит трубку.
          </li>
        </ul>
      </Block>

      <Block id="op112" title="Место оператора 112" newSheet>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Порядок: принять вызов → расспросить заявителя → заполнить карточку → «сохранить» → «оповестить и сохранить карточку» → отработки → «отработана».
            После «отработана» откроется разбор, и придёт следующий вызов.
          </li>
          <li>Опросная карта открывается после заполнения адреса, как в инструкции.</li>
          <li>
            Таймер набора в правом верхнем углу считает от «Принять» до «сохранить» и краснеет после норматива: <b>{typing}</b>.
          </li>
          <li>Точный адрес заявитель называет только на уточняющий вопрос: переспросите дом, корпус, подъезд. Похожие улицы — частая причина критичной ошибки.</li>
          <li>
            «нет контакта» — если в трубке тишина (сначала окликните абонента), «срыв звонка» — если связь оборвалась раньше, чем заявитель что-то сообщил. Обе
            работают, пока тип происшествия не выбран. Если заявитель успел назвать, что случилось и где, — заведите обычную карточку.
          </li>
          <li>
            Серая плашка — служба получает карточку только по телефону. После «сохранить» позвоните из «Отработок» (Alt+O): назовите номер карточки, адрес и что
            случилось, затем запишите, кто принял, и суть.
          </li>
          <li>«Дополнить» (Shift+F2) в сохранённой карточке: пустые при сохранении поля, описание и «Пострадавшие»; «Просмотр» (Shift+F1) — выйти без сохранения.</li>
        </ul>
        <H3>Горячие клавиши</H3>
        <p className="text-sm text-arm-desc">Зажмите Alt — рядом с блоками экрана появятся подсказки. Клавиши работают при любой раскладке.</p>
        <div className="overflow-x-auto">
          <table className={table}>
            <thead>
              <tr>
                <th>Клавиши</th>
                <th>Что делают</th>
              </tr>
            </thead>
            <tbody>
              {OP112_KEYS.map((k) => (
                <tr key={k.keys} className="break-inside-avoid">
                  <td className="whitespace-nowrap font-mono text-[13px]">{k.keys}</td>
                  <td>{k.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block id="voice" title="Как говорить голосом">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Нажмите и держите кнопку «Удерживайте, чтобы говорить» — или клавишу <b>пробел</b>. Говорите, потом отпустите: фраза уйдёт собеседнику. Пока на кнопке
            «Распознаю…», подождите.
          </li>
          <li>Пробел работает, когда курсор не стоит в поле ввода: если печатали, сначала щёлкните по пустому месту экрана.</li>
          <li>Собеседник отвечает голосом. Звук выключается кнопкой с динамиком на месте 112 и кнопкой «голос вкл.» в телефоне ДДС.</li>
          <li>
            Микрофон работает только по защищённому соединению: адрес в браузере начинается с <b>https://</b>. Когда браузер спросит разрешение на микрофон, нажмите
            «Разрешить».
          </li>
          <li>Нет микрофона или доступа к нему — говорите текстом: напечатайте фразу и нажмите Enter или «Сказать». Всё сказанное записывается одинаково.</li>
          <li>
            Перед занятием проверьте гарнитуру:{" "}
            <Link href="/headset" className="text-arm-blue underline">
              проверка гарнитуры
            </Link>
            .
          </li>
        </ul>
      </Block>

      <Block id="score" title="Как ставится оценка">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Тренажёр сам разбирает каждую карточку 112 (после «отработана») и каждую плашку своей службы на месте ДДС (после «Не принята», «Работы завершены», «Отказ»
            и в конце занятия): время, цитаты, «как правильно».
          </li>
          <li>Проверки разбиты на семь групп:</li>
        </ul>
        <ol className="list-decimal space-y-0.5 pl-10">
          {Object.values(WEIGHT_GROUPS).map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ol>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Балл — от 0 до 100: в каждой группе считается доля пройденных проверок, группы складываются с весами, которые задаёт преподаватель. Проверка, которая к
            карточке не относится, — «не применимо» и в балл не входит.
          </li>
          <li>Критичная ошибка (например, похожая улица вместо нужной или отказ от своего происшествия) ограничивает балл: не выше {CRITICAL_CAP}.</li>
          <li>
            Разбор тренажёра — черновик. Решение за преподавателем: он подтверждает оценку или исправляет её. До этого в «Моих результатах» попытка — «на проверке»,
            без балла. На самостоятельной тренировке разбор виден сразу на рабочем месте.
          </li>
          <li>В «Моих результатах» — балл, ошибки с доказательствами, «Что подтянуть», время реакции против норматива и прогноз на следующее занятие.</li>
        </ul>
      </Block>
    </div>
  );
}
