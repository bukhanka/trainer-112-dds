/** Mobile operator by the number prefix, as the workstation fills «канал связи» for the big four. */
export function channelOf(phone: string): string | undefined {
  const d = phone.replace(/\D/g, "").slice(-10);
  const code = d.slice(0, 3);
  if (/^91[0-9]$|^98[0-9]$/.test(code)) return "МТС";
  if (/^92[0-9]$|^93[0-9]$/.test(code)) return "Мегафон";
  if (/^90[3569]$|^96[0-9]$/.test(code)) return "Билайн";
  if (/^95[0-9]$|^977$|^99[0-9]$/.test(code)) return "Теле2";
  return undefined;
}
