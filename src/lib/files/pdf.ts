/**
 * The text layer of a PDF — a ticket saved from Word, not a scan — read by PDF.js (the serverless build in the
 * `unpdf` package, loaded only when a PDF comes in). Only the text is read — no rendering, no scripts, no fonts from
 * the system; pages are capped and the whole read has a time limit: a file from the network is never trusted.
 */
export class PdfError extends Error {}

type TextItem = { str?: string; hasEOL?: boolean };

export async function pdfText(buf: Uint8Array, { maxPages = 60, timeoutMs = 20_000 } = {}): Promise<{ text: string; pages: number; readPages: number }> {
  const { getDocumentProxy } = await import("unpdf");
  const work = (async () => {
    // PDF.js may take the buffer over, so it gets its own copy.
    const pdf = await getDocumentProxy(new Uint8Array(buf), { stopAtErrors: false, useSystemFonts: false, enableXfa: false });
    try {
      const readPages = Math.min(pdf.numPages, maxPages);
      const pages: string[] = [];
      for (let n = 1; n <= readPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push((content.items as TextItem[]).map((it) => (it.str ?? "") + (it.hasEOL ? "\n" : "")).join(""));
        page.cleanup();
      }
      return { text: pages.join("\n\n"), pages: pdf.numPages, readPages };
    } finally {
      await pdf.loadingTask.destroy();
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfError("PDF читается слишком долго — сохраните билет в DOCX или TXT")), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    if (err instanceof PdfError) throw err;
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") throw new PdfError("PDF защищён паролем — снимите защиту или сохраните билет в DOCX или TXT");
    throw new PdfError("Файл повреждён или это не PDF");
  } finally {
    clearTimeout(timer);
    work.catch(() => undefined);
  }
}
