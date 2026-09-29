import { describe, expect, it } from "vitest";
import { mockReply, type Persona } from "@/lib/op112/caller";
import { factCards } from "@/lib/op112/facts";
import { readDataJson } from "@/lib/routing/reference-json";
import type { CallLine } from "@/lib/op112/types";
import { firstPerson } from "./first-person";

describe("a ticket's note about the caller, said by the caller", () => {
  it("turns what the caller knows, sees and can do to the first person", () => {
    expect(firstPerson("Москва, улица Грина, номер дома не знает, в этом доме библиотека")).toBe("Москва, улица Грина, номер дома не знаю, в этом доме библиотека");
    expect(firstPerson("Людей на балконе не видно, пострадавших не видит")).toBe("Людей на балконе не видно, пострадавших не вижу");
    expect(firstPerson("Видит пожар, что горит — не знает")).toBe("Вижу пожар, что горит — не знаю");
    expect(firstPerson("Не может разбудить мужа, муж издаёт хрипы")).toBe("Не могу разбудить мужа, муж издаёт хрипы");
    expect(firstPerson("Проходит мимо, может подождать пожарных у ворот")).toBe("Прохожу мимо, могу подождать пожарных у ворот");
    expect(firstPerson("Дом 17 этажей, заявитель на 7-м, подъезд 3")).toBe("Дом 17 этажей, я на 7-м, подъезд 3");
  });

  it("leaves the sentences about someone else as they are", () => {
    for (const text of [
      "Полиция уже здесь, открыть не может.",
      "Приступ начался минут пятнадцать назад, дышит с трудом, говорить почти не может",
      "На вокзале у табло нет крепления! Может упасть на торговую палатку.",
      "Мужчина упал с моста в воду, кричит, что не умеет плавать",
      "Машина стоит у третьего подъезда",
      "Он не знает, где мы",
      "Не знаю, отсюда не видно.",
    ]) {
      expect(firstPerson(text), text).toBe(text);
    }
  });
});

type Row = { ticketRef: string; caller: Persona };
const tickets = [...readDataJson<Row[]>("scenarios.json"), ...readDataJson<Row[]>("scenarios-card-errors.json")].filter((s) => s.caller?.situation);

/** A caller speaking of himself in the third person, the way a ticket is written. */
const THIRD_PERSON = /(?<![а-яё])(не\s+)?(знает|видит|помнит|слышит)(?![а-яё])|(?<![а-яё])заявител/i;

describe("the caller without a model never speaks of himself in the third person", () => {
  const questions = [
    "Служба 112, что у вас случилось?",
    "Назовите адрес",
    "Уточните номер дома, что рядом",
    "Есть пострадавшие?",
    "Сколько этажей в доме, дом газифицирован?",
    "Сознание есть? Дышит?",
    "Какой номер машины?",
  ];

  it.each(tickets.map((s) => [s.ticketRef, s.caller] as const))("%s", (_ref, persona) => {
    const history: CallLine[] = [{ role: "counterpart", text: "Алло…", at: "", revealed: [] }];
    for (const q of questions) {
      const r = mockReply(persona, history, q);
      expect(r.text, q).not.toMatch(THIRD_PERSON);
      history.push({ role: "trainee", text: q, at: "" }, { role: "counterpart", text: r.text, at: "", revealed: r.revealed });
    }
    // The address the caller gives is the one the check of what was said looks for.
    const address = factCards(persona).find((f) => f.key === "address")!;
    expect(address.text).not.toMatch(THIRD_PERSON);
  });
});
