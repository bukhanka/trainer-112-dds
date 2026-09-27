import { describe, expect, it } from "vitest";
import { errorTitle } from "./errors";

describe("errors are named as errors", () => {
  it("turns the title of a check into its mistake", () => {
    expect(errorTitle({ code: "dds.closing_status", title: "Карточка закрыта правильным статусом" })).toBe("Карточка закрыта не тем статусом");
    expect(errorTitle({ code: "op112.empty", title: "Карточка не сохранена пустой по ошибке" })).toBe("Карточка сохранена пустой по ошибке");
    expect(errorTitle({ code: "op112.ai.said", title: "ИИ: всё сказанное заявителем попало в карточку" })).toBe("ИИ: не всё сказанное заявителем попало в карточку");
  });

  it("drops the time of one attempt, so the same error of two attempts is one", () => {
    expect(errorTitle({ code: "op112.typing_time", title: "Карточка сохранена за 3:44" })).toBe(errorTitle({ code: "op112.typing_time", title: "Карточка сохранена за 2:01" }));
    expect(errorTitle({ code: "dds.ack_in_time", title: "Ответ «Принята / Не принята» за 30 с" })).toBe("Нет ответа «Принята / Не принята» в норматив");
  });

  it("keeps what exactly was asked or said", () => {
    expect(errorTitle({ code: "op112.question.2", title: "Задан вопрос: Есть ли угроза людям" })).toBe("Не задан вопрос: Есть ли угроза людям");
    expect(errorTitle({ code: "op112.said.floor", title: "Сказал ↔ заполнил: этажность" })).toBe("Не перенесено в карточку: этажность");
    expect(errorTitle({ code: "op112.flag.gas", title: "Флаг «Проведена ли газификация»" })).toBe("Неверный флаг «Проведена ли газификация»");
  });

  it("falls back to «Не выполнено» for an unknown check", () => {
    expect(errorTitle({ code: "x.y", title: "Что-то проверено" })).toBe("Не выполнено: Что-то проверено");
    expect(errorTitle({ code: "dds.closing_status", title: "Карточка закрыта итоговым статусом" })).toBe("Карточка не закрыта итоговым статусом");
  });
});
