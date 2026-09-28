import { describe, expect, it } from "vitest";
import { EXE, makeDocx, makePdf, makeXlsx, makeZip, PNG, para, table } from "../../../tests/office-files";
import { detectMaterial, extensionOf } from "./detect";
import { blocksFromDocumentXml, blocksToText, docxBlocks, DocxError } from "./docx";
import { cleanFileName, contentDisposition, formatBytes, titleFromFileName } from "./names";
import { pdfText } from "./pdf";
import { decodeText, looksLikeMarkup } from "./text";
import { readZipEntries, readZipEntry, ZipError } from "./zip";

describe("zip reader", () => {
  it("lists the entries and inflates one", () => {
    const zip = makeZip({ "a.txt": "привет", "dir/b.xml": "<b/>" });
    const entries = readZipEntries(zip)!;
    expect([...entries.keys()]).toEqual(["a.txt", "dir/b.xml"]);
    expect(new TextDecoder().decode(readZipEntry(zip, entries.get("a.txt")!, 1000))).toBe("привет");
    const stored = makeZip({ "a.txt": "plain" }, { deflate: false });
    expect(new TextDecoder().decode(readZipEntry(stored, readZipEntries(stored)!.get("a.txt")!, 1000))).toBe("plain");
  });

  it("refuses what is not an archive", () => {
    expect(readZipEntries(new Uint8Array(0))).toBeNull();
    expect(readZipEntries(EXE)).toBeNull();
    expect(readZipEntries(new TextEncoder().encode("PK but not really a zip file at all, just text"))).toBeNull();
  });

  it("stops a zip bomb at the cap instead of filling the memory", () => {
    const zip = makeZip({ "bomb.xml": "A".repeat(5_000_000) });
    const entry = readZipEntries(zip)!.get("bomb.xml")!;
    expect(zip.length).toBeLessThan(20_000);
    expect(() => readZipEntry(zip, entry, 1_000_000)).toThrow(ZipError);
    // A lying size in the directory does not help: inflating itself is capped.
    expect(() => readZipEntry(zip, { ...entry, size: 10 }, 1_000_000)).toThrow(ZipError);
  });
});

describe("text of a Word document", () => {
  it("keeps paragraphs, tabs, breaks and entities, and tables row by row", () => {
    const xml = `<w:document><w:body>
      <w:p><w:r><w:t>БИЛЕТ 1</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Улица </w:t></w:r><w:r><w:tab/><w:t>&lt;Грина&gt; &amp; 11</w:t><w:br/><w:t>вторая строка</w:t></w:r></w:p>
      ${table([
        ["№", "Ситуация", "Адрес"],
        ["1", "Горит мусор", "Москва, Депо"],
      ])}
    </w:body></w:document>`;
    const blocks = blocksFromDocumentXml(xml);
    expect(blocks[0]).toEqual({ kind: "p", text: "БИЛЕТ 1" });
    expect(blocks[1]).toEqual({ kind: "p", text: "Улица \t<Грина> & 11\nвторая строка" });
    expect(blocks[2]).toEqual({ kind: "table", rows: [["№", "Ситуация", "Адрес"], ["1", "Горит мусор", "Москва, Депо"]] });
    expect(blocksToText(blocks)).toContain("1 · Горит мусор · Москва, Депо");
  });

  it("skips deleted text, field codes and the fallback copy of a text box", () => {
    const xml = `<w:body><w:p>
      <w:del><w:r><w:delText>старое</w:delText></w:r></w:del>
      <w:r><w:instrText>HYPERLINK "x"</w:instrText></w:r>
      <w:r><w:t>новое</w:t></w:r>
      <mc:AlternateContent><mc:Choice><w:p><w:r><w:t>в рамке</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>в рамке</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>
    </w:p></w:body>`;
    const text = blocksToText(blocksFromDocumentXml(xml));
    expect(text).not.toContain("старое");
    expect(text).not.toContain("HYPERLINK");
    expect(text.match(/в рамке/g)).toHaveLength(1);
    expect(text).toContain("новое");
  });

  it("keeps a table inside a cell as the text of that cell", () => {
    const inner = `<w:tbl><w:tr><w:tc>${para("вложенная")}</w:tc><w:tc>${para("таблица")}</w:tc></w:tr></w:tbl>`;
    const xml = `<w:body><w:tbl><w:tr><w:tc>${para("1")}</w:tc><w:tc>${para("текст")}${inner}</w:tc></w:tr></w:tbl></w:body>`;
    expect(blocksFromDocumentXml(xml)).toEqual([{ kind: "table", rows: [["1", "текст\nвложенная | таблица"]] }]);
  });

  it("reads a real DOCX archive and explains a broken one", () => {
    expect(blocksToText(docxBlocks(makeDocx(para("Горит квартира"))))).toBe("Горит квартира");
    expect(() => docxBlocks(EXE)).toThrow(DocxError);
    expect(() => docxBlocks(makeZip({ "xl/workbook.xml": "<x/>" }))).toThrow(/нет текста документа Word/);
  });
});

describe("text files", () => {
  it("reads UTF-8, UTF-8 with the mark, UTF-16 and Windows-1251", () => {
    expect(decodeText(new TextEncoder().encode("Пожар"))).toEqual({ text: "Пожар", charset: "utf-8" });
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Газ")]))).toEqual({ text: "Газ", charset: "utf-8" });
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x1f, 0x04, 0x40, 0x04]))).toEqual({ text: "Пр", charset: "utf-16le" });
    expect(decodeText(new Uint8Array([0xcf, 0xee, 0xe6, 0xe0, 0xf0]))).toEqual({ text: "Пожар", charset: "windows-1251" });
  });

  it("refuses binary content and spots markup", () => {
    expect(decodeText(EXE)).toBeNull();
    expect(decodeText(PNG)).toBeNull();
    expect(looksLikeMarkup("  <!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeMarkup("Текст\n<script>alert(1)</script>")).toBe(true);
    expect(looksLikeMarkup("<svg onload=alert(1)>")).toBe(true);
    expect(looksLikeMarkup("Сравнение: 3 < 5 и 7 > 2")).toBe(false);
  });
});

describe("what may go into the library", () => {
  const ok = (name: string, bytes: Uint8Array) => detectMaterial(name, bytes);

  it("accepts the listed types when the content matches the name", () => {
    expect(ok("Памятка.PDF", makePdf("Memo"))).toMatchObject({ ok: true, kind: "pdf", mime: "application/pdf" });
    expect(ok("Методичка.docx", makeDocx(para("текст")))).toMatchObject({ ok: true, kind: "docx" });
    expect(ok("Позывные.xlsx", makeXlsx())).toMatchObject({ ok: true, kind: "xlsx" });
    expect(ok("Схема.png", PNG)).toMatchObject({ ok: true, kind: "png", mime: "image/png" });
    expect(ok("Фото.jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toMatchObject({ ok: true, kind: "jpg", ext: "jpeg" });
    expect(ok("a.gif", new TextEncoder().encode("GIF89a....."))).toMatchObject({ ok: true, kind: "gif" });
    expect(ok("a.webp", new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toMatchObject({ ok: true, kind: "webp" });
    expect(ok("Инструкция.txt", new Uint8Array([0xcf, 0xee, 0xe6, 0xe0, 0xf0]))).toMatchObject({ ok: true, mime: "text/plain; charset=windows-1251" });
  });

  it.each([
    ["setup.exe", EXE, /\.exe не принимаются/],
    ["page.html", new TextEncoder().encode("<html><script>alert(1)</script></html>"), /\.html не принимаются/],
    ["image.svg", new TextEncoder().encode("<svg onload=alert(1)/>"), /\.svg не принимаются/],
    ["script.js", new TextEncoder().encode("alert(1)"), /\.js не принимаются/],
    ["README", new TextEncoder().encode("text"), /без расширения/],
    ["program.pdf", EXE, /не совпадает с расширением \.pdf/],
    ["photo.png", makePdf("x"), /не совпадает с расширением \.png/],
    ["virus.docx", EXE, /не совпадает с расширением \.docx/],
    ["page.txt", new TextEncoder().encode("<!doctype html><html><body>hi</body></html>"), /веб-страницу/],
    ["binary.txt", EXE, /не текстовый файл/],
    ["empty.pdf", new Uint8Array(0), /пустой/],
  ])("refuses %s", (name, bytes, reason) => {
    const res = detectMaterial(name, bytes);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(reason);
  });

  it("refuses Office files with macros or embedded programs, and a workbook sent as a document", () => {
    expect(detectMaterial("m.docx", makeDocx(para("x"), { "word/vbaProject.bin": "VBA" }))).toMatchObject({ ok: false, error: expect.stringMatching(/макрос/) });
    expect(detectMaterial("m.xlsx", makeXlsx({ "xl/vbaProject.bin": "VBA" }))).toMatchObject({ ok: false });
    expect(detectMaterial("o.docx", makeDocx(para("x"), { "word/embeddings/oleObject1.bin": "OLE" }))).toMatchObject({ ok: false, error: expect.stringMatching(/встроенный объект/) });
    expect(detectMaterial("t.docx", makeXlsx())).toMatchObject({ ok: false, error: expect.stringMatching(/повреждён|не документ/) });
    // An embedded workbook (a chart in a report) is ordinary.
    expect(detectMaterial("c.docx", makeDocx(para("x"), { "word/embeddings/Microsoft_Excel_Worksheet.xlsx": makeXlsx() }))).toMatchObject({ ok: true });
  });

  it("takes the extension from the last dot of the base name only", () => {
    expect(extensionOf("../../etc/passwd")).toBe("");
    expect(extensionOf("C:\\Users\\x\\отчёт.v2.PDF")).toBe("pdf");
    expect(extensionOf(".bashrc")).toBe("");
  });
});

describe("names of files", () => {
  it("keeps no folder, no control or reserved characters, and the extension", () => {
    expect(cleanFileName("../../etc/passwd.pdf", "pdf")).toBe("passwd.pdf");
    expect(cleanFileName("C:\\Users\\teacher\\Памятка ДДС.pdf", "pdf")).toBe("Памятка ДДС.pdf");
    expect(cleanFileName('bad\u0000na<me>:"|?*.txt', "txt")).toBe("bad_na_me______.txt");
    expect(cleanFileName("...", "docx")).toBe("материал.docx");
    expect(cleanFileName("Фото", "jpg")).toBe("Фото.jpg");
    expect(cleanFileName("Фото.JPG", "jpg")).toBe("Фото.jpg");
    expect(cleanFileName("я".repeat(300) + ".pdf", "pdf")).toBe("я".repeat(100) + ".pdf");
  });

  it("builds the title from the name", () => {
    expect(titleFromFileName("Памятка_ДДС-2026.pdf")).toBe("Памятка ДДС-2026");
    expect(titleFromFileName(".pdf")).toBe(".pdf");
  });

  it("offers the Russian name to the browser and a plain one to old clients", () => {
    const header = contentDisposition("attachment", 'Памятка "ДДС" (2026).pdf');
    expect(header).toBe(`attachment; filename="_______ _____ (2026).pdf"; filename*=UTF-8''%D0%9F%D0%B0%D0%BC%D1%8F%D1%82%D0%BA%D0%B0%20%22%D0%94%D0%94%D0%A1%22%20%282026%29.pdf`);
    expect(contentDisposition("inline", "a;b.txt")).toMatch(/^inline; filename="a_b\.txt"/);
    expect(header).not.toMatch(/[\r\n]/);
  });

  it("writes sizes the Russian way", () => {
    expect(formatBytes(900)).toBe("900 Б");
    expect(formatBytes(1536)).toBe("1,5 КБ");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 МБ");
  });
});

describe("text of a PDF", () => {
  it("reads the text layer", async () => {
    const res = await pdfText(makePdf("Fire at Grina street 11"));
    expect(res.pages).toBe(1);
    expect(res.text).toContain("Fire at Grina street 11");
  });

  it("refuses a broken file", async () => {
    await expect(pdfText(new TextEncoder().encode("%PDF-1.4\nnot really"))).rejects.toThrow(/повреждён|не PDF/);
  });
});
