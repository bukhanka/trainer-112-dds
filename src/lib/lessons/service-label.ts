/**
 * Labels of the lesson form's services. A plain module (not a client component): the lesson page renders them on
 * the server, and a server component cannot call a function exported from a "use client" file.
 */

/** Okrug ДДС of the customer's list: «Поселение ЮЗАО» is the prefecture of the okrug, not a settlement. */
const PREFECTURE = /^Поселение\s+(ЦАО|САО|СВАО|ВАО|ЮВАО|ЮАО|ЮЗАО|ЗАО|СЗАО|ЗелАО|ТиНАО|ТАО|НАО)$/;

/**
 * What a territorial ДДС is: the customer's list names them all «Поселение …», the full name tells a district
 * («ДДС района Щукино»), a settlement of ТиНАО («ДДС поселения Вороновское»), a town («городского округа Троицк»)
 * and a prefecture apart.
 */
function territoryKind(shortName: string, fullName: string | null | undefined): string {
  const full = (fullName ?? "").toLowerCase();
  if (PREFECTURE.test(shortName) || full.includes("префектур")) return "префектура";
  if (full.includes("городского округа")) return "городской округ";
  if (full.includes("поселени")) return "поселение";
  return "район";
}

/** «Поселение Щукино» → «Щукино — район»: the part that tells 150 territorial services apart comes first. */
export function serviceLabel(shortName: string, fullName?: string | null): string {
  const territorial = /^Поселение\s+(.+)$/.exec(shortName);
  if (territorial) return `${territorial[1]} — ${territoryKind(shortName, fullName)}`;
  const council = /^Упр\.\s*района\s+(.+)$/.exec(shortName);
  if (council) return `${council[1]} — управа района`;
  return shortName;
}
