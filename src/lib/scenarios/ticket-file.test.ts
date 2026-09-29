import { describe, expect, it } from "vitest";
import { EXE, makeDocx, makePdf, para, table } from "../../../tests/office-files";
import type { DocBlock } from "../files/docx";
import { pdfBlocks, pdfLines, type PdfItem } from "../files/pdf-table";
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

describe("tables typed as text and tables of a PDF", () => {
  it("a text file with «|» between the cells: one row per line", () => {
    const res = splitTickets(
      lines(
        "БИЛЕТ 1\nОтработайте вызовы от заявителя\n№ | Ситуация | Адрес\n1 | Возгорание мусорного контейнера, пострадавших нет | Москва, Депо, около ст. Москва-Пассажирская Киевская\n2 | Дерутся 10-15 человек, 5 пострадавших | Москва, рядом с посольством Азербайджана\n3 | Ребенок 11 лет упал с велосипеда | Волгоградская обл., г. Волжский\n(верхняя половина листа пустая)",
      ),
    );
    expect(res.tickets).toBe(1);
    expect(res.fragments.map((f) => f.label)).toEqual(["Билет 1, ситуация 1", "Билет 1, ситуация 2", "Билет 1, ситуация 3"]);
    expect(res.fragments[0].text).toBe("Возгорание мусорного контейнера, пострадавших нет. Адрес: Москва, Депо, около ст. Москва-Пассажирская Киевская");
  });

  it("a row going on in the next line «  | Адрес: …», the column names written into the cells, blank lines between rows", () => {
    const res = splitTickets(
      lines(
        "Транскрипция билетов\n=====\np-02\nБИЛЕТ 2\nОтработайте вызовы от заявителя\nТаблица: № | Ситуация | Адрес\n\n1 | Ситуация: Задымление мусоропровода, пострадавших нет\n  | Адрес: Москва, ул. Берзарина, дом 21\n\n2 | Ситуация: Поругался с продавцом, бросил трубку\n  | Адрес: Москва, Сущевский Вал дом 5\n\nКурсива в адресах нет.",
      ),
    );
    expect(res.fragments).toEqual([
      { label: "Билет 2, ситуация 1", text: "Задымление мусоропровода, пострадавших нет. Адрес: Москва, ул. Берзарина, дом 21", long: false },
      { label: "Билет 2, ситуация 2", text: "Поругался с продавцом, бросил трубку. Адрес: Москва, Сущевский Вал дом 5", long: false },
    ]);
  });

  it("rows printed as «№ 1 / Ситуация: … / Адрес: …», a Markdown table", () => {
    const numbered = splitTickets(lines("БИЛЕТ 12\n№ 1\nСитуация: Сильное задымление в зале ресторана,\nо пострадавших информации нет\nАдрес: МО, дер. Жуковка\n[примечание: курсив]\n№ 2\nСитуация: Боли в сердце\nАдрес: Тульская обл."));
    expect(numbered.fragments.map((f) => f.text)).toEqual([
      "Сильное задымление в зале ресторана, о пострадавших информации нет. Адрес: МО, дер. Жуковка",
      "Боли в сердце. Адрес: Тульская обл.",
    ]);
    const md = splitTickets(lines("| № | Ситуация | Адрес |\n|---|---|---|\n| 1 | Горит мусор | ул. Грина, 11 |\n| 2 | Пахнет газом | ул. Вавилова, 81 |"));
    expect(md.fragments.map((f) => f.text)).toEqual(["Горит мусор. Адрес: ул. Грина, 11", "Пахнет газом. Адрес: ул. Вавилова, 81"]);
  });

  // Runs of a PDF table as LibreOffice writes it (the jury's file): the header words in the middle of their columns,
  // the number of a row in the middle of the row, the address of a row before its number.
  const item = (str: string, x: number, y: number, w = 150): PdfItem => ({ str, x, y, w, h: 12 });
  const juryPdf: PdfItem[] = [
    item("БИЛЕТ 1", 57, 802, 51),
    item("Отработайте вызовы от заявителя", 57, 774, 173),
    item("№", 60, 744, 12),
    item("Ситуация", 161, 744, 54),
    item("Адрес", 418, 744, 32),
    item("Москва, Депо, около ст. Москва-Пассажирская", 302, 713, 241),
    item("1", 58, 693, 6),
    item("Возгорание мусорного контейнера,", 76, 706),
    item("пострадавших нет, Сидоров Иван", 76, 693),
    item("Сергеевич,916-126-34-71", 76, 679),
    item("Киевская, длинное помещение", 302, 700),
    item("2 стр.2)", 302, 672, 39),
    item("2", 58, 620, 6),
    item("Дерутся 10-15 человек, 5 пострадавших с", 76, 641),
    item("различными травмами", 76, 627),
    item("Москва, рядом с посольством Азербайджана на", 302, 627),
    item("тротуаре (Леонтьевский переулок, дом 16, стр.1)", 302, 613),
    item("Иванович, 916-123-98-78", 76, 600),
    item("3", 58, 555, 6),
    item("Ребенок 11 лет, Смирнов Илья упал с", 76, 569),
    item("Волгоградская обл., г. Волжский, ул. Карла", 302, 562),
    item("Вызывает мама, 9163201283", 76, 541),
  ];

  it("a table of a PDF is rebuilt by the positions of its words, whatever order they are written in", () => {
    const blocks = pdfBlocks([juryPdf])!;
    const res = splitTickets(blocks);
    expect(res.tickets).toBe(1);
    expect(res.fragments.map((f) => f.text)).toEqual([
      "Возгорание мусорного контейнера, пострадавших нет, Сидоров Иван Сергеевич,916-126-34-71. Адрес: Москва, Депо, около ст. Москва-Пассажирская Киевская, длинное помещение 2 стр.2)",
      "Дерутся 10-15 человек, 5 пострадавших с различными травмами Иванович, 916-123-98-78. Адрес: Москва, рядом с посольством Азербайджана на тротуаре (Леонтьевский переулок, дом 16, стр.1)",
      "Ребенок 11 лет, Смирнов Илья упал с Вызывает мама, 9163201283. Адрес: Волгоградская обл., г. Волжский, ул. Карла",
    ]);
    // A PDF without such a table is read as text, the lines wrapped at the right margin joined back.
    expect(pdfBlocks([[item("Горит квартира, ул. Грина, 11", 57, 700)]])).toBeNull();
  });

  it("a PDF made of a text file: «|» rows wrapped by the page are joined back", () => {
    const wrapped = pdfLines([
      [
        item("БИЛЕТ 1", 57, 800, 50),
        item("№ | Ситуация | Адрес", 57, 780, 120),
        item("1 | Возгорание мусорного контейнера, пострадавших нет, Сидоров Иван", 57, 760, 480),
        item("Сергеевич | Москва, Депо", 57, 745, 140),
        item("2 | Дерутся 10-15 человек | Москва, рядом с посольством", 57, 730, 300),
      ],
    ]);
    const res = splitTickets(wrapped);
    expect(res.fragments.map((f) => f.text)).toEqual([
      "Возгорание мусорного контейнера, пострадавших нет, Сидоров Иван Сергеевич. Адрес: Москва, Депо",
      "Дерутся 10-15 человек. Адрес: Москва, рядом с посольством",
    ]);
  });
});
