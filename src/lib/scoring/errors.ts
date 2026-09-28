/**
 * The name of a failed check as an error. A check is titled by what is right («Карточка закрыта правильным
 * статусом»); in lists of mistakes — the board, summaries, reports — it must read as the mistake itself
 * («Карточка закрыта не тем статусом»), with no time or detail of one attempt in it, so that the same error
 * of different attempts is counted as one. Pure: used on the server and in the browser.
 */
import type { CriterionResult } from "./score";

const BY_CODE: Record<string, string> = {
  // ДДС place
  "dds.open_in_time": "Карточка открыта позже норматива",
  "dds.first_record_in_time": "Первая запись (статус и текст) позже норматива",
  "dds.card_error_reported": "Об ошибке в карточке не сообщено в 112",
  "dds.card_error_in_comment": "В итогах не исправлена ошибка карточки",
  // Checks of reviews made before the norms became «open in 30 s, first record in 3 min»
  "dds.ack_in_time": "Нет ответа «Принята / Не принята» в норматив",
  "dds.crew_in_time": "Наряд не направлен в пределах отработки",
  "dds.crew_calls_answered": "Пропущены звонки наряда",
  "dds.status_after_report": "Статус не поставлен сразу после доклада наряда",
  "dds.refusal_reason": "В «Не принята» / «Отказ» не указана причина",
  "dds.transfer_named": "Не указано, кому передана информация",
  "dds.final_comment": "Итоговый комментарий без итогов работ",
  "dds.comment_content": "В комментарии нет того, что требует эталон",
  "dds.comment_template": "Итоговый комментарий не по шаблону занятия",
  "dds.progress_statuses": "Пропущены статусы хода работ",
  "dds.status_by_facts": "Статус поставлен раньше доклада наряда",
  "dds.status_meaning": "Статус противоречит смыслу комментария",
  "dds.closing_status": "Карточка закрыта не тем статусом",
  "dds.decision": "Решение службы не совпадает с эталоном",
  "dds.callback_rules": "Заявителю назван номер карточки",
  "dds.literacy": "Комментарии непонятны следующему диспетчеру",
  "dds.ai.literacy": "ИИ: комментарии непонятны следующему диспетчеру",
  // 112 place
  "op112.typing_time": "Карточка набрана дольше норматива",
  "op112.empty": "Карточка сохранена пустой по ошибке",
  "op112.empty.hail": "Вызов закрыт, а абонента не окликнули",
  "op112.empty.card": "По пустому вызову заведена карточка со службами",
  "op112.dropped.card": "Сорвавшийся вызов с данными закрыт пустой карточкой",
  "op112.address.street": "Улица не совпадает с местом происшествия",
  "op112.address.house": "Неверно указаны дом, корпус или строение",
  "op112.address.district": "Район определён неверно",
  "op112.address.region": "Неверно указаны населённый пункт или субъект",
  "op112.address.details": "Неверно указаны квартира, подъезд, этаж или код",
  "op112.type": "Неверный тип происшествия («что случилось»)",
  "op112.class": "Неверная классификация по опросной карте («Класс.»)",
  "op112.services.missing": "Оповещены не все нужные службы",
  "op112.services.extra": "В карточке лишние службы",
  "op112.phone.notified": "Не все службы, работающие по телефону, оповещены",
  "op112.link.repeat": "Повторный вызов не привязан к карточке первого вызова",
  "op112.link.extra": "Лишняя связь с другой карточкой",
  "op112.field.fullName": "Не заполнены фамилия и имя заявителя",
  "op112.field.status": "Не выбран статус заявителя",
  "op112.field.phone": "Не заполнен предоставленный телефон",
  "op112.field.description": "Не заполнено описание со слов заявителя",
  "op112.description.first100": "Суть и пострадавшие — не в первых 100 символах описания",
  "op112.ai.said": "ИИ: не всё сказанное заявителем попало в карточку",
  "op112.ai.description": "ИИ: описание непонятно следующему диспетчеру",
  // older checks of the demo lessons
  "op112.address_street": "Улица записана неверно",
  "op112.address_clarified": "Адрес не уточнён до дома и ориентира",
  "op112.services": "Службы выбраны неверно",
  "op112.questions": "Не заданы обязательные вопросы опросной карты",
};

/** Checks whose title names what exactly was checked: the error keeps that detail. */
const FROM_TITLE: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Задан вопрос:\s*(.+)$/, (m) => `Не задан вопрос: ${m[1]}`],
  [/^Сказал ↔ заполнил:\s*(.+)$/, (m) => `Не перенесено в карточку: ${m[1]}`],
  [/^Флаг «(.+)»$/, (m) => `Неверный флаг «${m[1]}»`],
  [/^Нерезультативный вызов закрыт кнопкой «(.+)»$/, (m) => `Нерезультативный вызов не закрыт кнопкой «${m[1]}»`],
];

export function errorTitle(c: Pick<CriterionResult, "code" | "title">): string {
  for (const [re, name] of FROM_TITLE) {
    const m = c.title.match(re);
    if (m) return name(m);
  }
  // The demo lessons checked «closed at all», the workstation — «closed with the right status».
  if (c.code === "dds.closing_status" && /итоговым статусом/.test(c.title)) return "Карточка не закрыта итоговым статусом";
  return BY_CODE[c.code] ?? `Не выполнено: ${c.title}`;
}
