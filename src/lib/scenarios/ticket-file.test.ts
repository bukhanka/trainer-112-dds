import { describe, expect, it } from "vitest";
import { EXE, makeDocx, makePdf, para, table } from "../../../tests/office-files";
import type { DocBlock } from "../files/docx";
import { DRAFT_TEXT_LIMIT, splitTickets, ticketsFromFile } from "./ticket-file";

const p = (text: string): DocBlock => ({ kind: "p", text });
const lines = (text: string) => text.split("\n").map(p);

// The customer's ticket layout: «БИЛЕТ N», the task, a table «№ · Ситуация · Адрес» of three situations.
const TICKET_1 = [
  ["№", "Ситуация", "Адрес"],
  ["1", "Возгорание мусорного контейнера, пострадавших нет, Сидоров Иван Сергеевич, 916-126-34-71", "Москва, Депо, около ст. Москва-Пассажирская Киевская (МЖД Киевская 1 км, стр. 2)"],
  ["2", "Дерутся 10-15 человек, 5 пострадавших, Иванов Петр Иванович, 916-123-98-78", "Москва, рядом с посольством Азербайджана (Леонтьевский переулок, дом 16, стр. 1)"],
  ["3", "Ребёнок 11 лет упал с велосипеда, стёр руки и ноги. Вызывает мама", "Волгоградская обл., г. Волжский, ул. Карла Маркса"],
];
const TICKET_2 = [
  ["№", "Ситуация", "Адрес"],
  ["1", "Горит квартира на 5 этаже, в квартире ребёнок", "ул. Грина, 11"],
  ["2", "Запах газа в подъезде", "ул. Вавилова, 81"],
  ["3", "Застряли в лифте", "ул. Берзарина, 21"],
];

describe("cutting a ticket file into situations", () => {
  it("takes the situations of the customer's ticket tables, named by ticket and number", () => {
    const res = splitTickets([
      p("БИЛЕТ 1"),
      p("Отработайте вызовы от заявителя"),
      { kind: "table", rows: TICKET_1 },
      p(""),
      p("Билет № 2"),
      p("Отработайте вызовы от заявителя"),
      { kind: "table", rows: TICKET_2 },
    ]);
    expect(res.tickets).toBe(2);
    expect(res.fragments.map((f) => f.label)).toEqual([
      "Билет 1, ситуация 1",
      "Билет 1, ситуация 2",
      "Билет 1, ситуация 3",
      "Билет 2, ситуация 1",
      "Билет 2, ситуация 2",
      "Билет 2, ситуация 3",
    ]);
    expect(res.fragments[0].text).toBe(
      "Возгорание мусорного контейнера, пострадавших нет, Сидоров Иван Сергеевич, 916-126-34-71. Адрес: Москва, Депо, около ст. Москва-Пассажирская Киевская (МЖД Киевская 1 км, стр. 2)",
    );
    // The task wording around a table is not a situation.
    expect(res.fragments.some((f) => /Отработайте/.test(f.text))).toBe(false);
  });

  it("takes rows under a header when the table has no numbers", () => {
    const res = splitTickets([{ kind: "table", rows: [["Ситуация", "Адрес"], ["Горит мусор", "ул. Грина, 11"], ["Пахнет газом", "ул. Вавилова, 81"]] }]);
    expect(res.fragments).toEqual([
      { label: "ситуация 1", text: "Горит мусор. Адрес: ул. Грина, 11", long: false },
      { label: "ситуация 2", text: "Пахнет газом. Адрес: ул. Вавилова, 81", long: false },
    ]);
  });

  it("splits numbered lines of a text file, joining the lines a situation wraps over", () => {
    const res = splitTickets(lines("Билет 7\nОтработайте вызовы:\n1. Горит квартира на 5 этаже,\nв квартире остался ребёнок, ул. Грина, 11\n2) Пахнет газом в подъезде, ул. Вавилова, 81\n3. Застряли в лифте"));
    expect(res.tickets).toBe(1);
    expect(res.fragments.map((f) => [f.label, f.text])).toEqual([
      ["Билет 7, ситуация 1", "Горит квартира на 5 этаже, в квартире остался ребёнок, ул. Грина, 11"],
      ["Билет 7, ситуация 2", "Пахнет газом в подъезде, ул. Вавилова, 81"],
      ["Билет 7, ситуация 3", "Застряли в лифте"],
    ]);
  });

  it("keeps one situation whole: a single numbered line, no numbers, no ticket heading", () => {
    expect(splitTickets(lines("Горит квартира на 5 этаже.\nЗвонит соседка снизу, ул. Грина, 11")).fragments).toEqual([
      { label: "Текст файла", text: "Горит квартира на 5 этаже. Звонит соседка снизу, ул. Грина, 11", long: false },
    ]);
    // «2» after «1» is required: a date or a count in the text does not split it.
    expect(splitTickets(lines("1. Горит дом\n5. этаж, ул. Грина")).fragments).toHaveLength(1);
    // A sentence that mentions a ticket is not a heading.
    expect(splitTickets(lines("Билет 3 из прошлого года: пожар в школе, в здании остались дети, ученики эвакуированы не все, звонит директор школы")).tickets).toBe(0);
  });

  it("flags a situation longer than the draft generator reads", () => {
    const res = splitTickets([p("x".repeat(DRAFT_TEXT_LIMIT + 1))]);
    expect(res.fragments[0].long).toBe(true);
  });
});

describe("reading the uploaded file", () => {
  it("reads a Word ticket", async () => {
    const docx = makeDocx(`${para("БИЛЕТ 1")}${para("Отработайте вызовы от заявителя")}${table(TICKET_1)}`);
    const res = await ticketsFromFile("Билеты.docx", docx);
    expect(res.ok && res.file).toMatchObject({ kind: "docx", tickets: 1, notes: [] });
    expect(res.ok && res.file.fragments.map((f) => f.label)).toEqual(["Билет 1, ситуация 1", "Билет 1, ситуация 2", "Билет 1, ситуация 3"]);
  });

  it("reads a text file saved by Russian Windows", async () => {
    const cp1251 = new Uint8Array([0xc3, 0xee, 0xf0, 0xe8, 0xf2, 0x20, 0xea, 0xe2, 0xe0, 0xf0, 0xf2, 0xe8, 0xf0, 0xe0, 0x2c, 0x20, 0xf3, 0xeb, 0x2e, 0x20, 0xc3, 0xf0, 0xe8, 0xed, 0xe0, 0x2c, 0x20, 0x31, 0x31]);
    const res = await ticketsFromFile("билет.txt", cp1251);
    expect(res.ok && res.file.fragments).toEqual([{ label: "Текст файла", text: "Горит квартира, ул. Грина, 11", long: false }]);
  });

  it("reads a PDF with text and explains a scan", async () => {
    const res = await ticketsFromFile("ticket.pdf", makePdf("Fire in a flat, Grina street 11, a child inside"));
    expect(res.ok && res.file.fragments[0].text).toContain("Fire in a flat");
    const scan = await ticketsFromFile("scan.pdf", makePdf(""));
    expect(scan).toMatchObject({ ok: false, error: expect.stringMatching(/скан/) });
  });

  it.each([
    ["old.doc", EXE, /\.doc не читается/],
    ["setup.exe", EXE, /DOCX, TXT или PDF/],
    ["fake.docx", EXE, /не документ Word/],
    ["fake.pdf", EXE, /не PDF/],
    ["binary.txt", EXE, /не текстовый файл/],
    ["empty.txt", new Uint8Array(0), /пустой/],
  ])("refuses %s with a reason", async (name, bytes, reason) => {
    const res = await ticketsFromFile(name, bytes);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(reason);
  });

  it("points a big document without tickets to «Материалы»", async () => {
    const res = await ticketsFromFile("методичка.txt", new TextEncoder().encode("Общие положения методики. ".repeat(400)));
    expect(res.ok && res.file.notes.join(" ")).toMatch(/Материалы/);
  });
});
