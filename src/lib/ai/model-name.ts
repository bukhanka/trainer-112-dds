/** Model name for drafts and the audit journal — never the endpoint address, which may be an internal host. */
export function modelName(): string {
  return process.env.LLM_MODEL || "default";
}
