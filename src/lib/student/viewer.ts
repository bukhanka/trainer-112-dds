import { practiceKey } from "@/lib/dds/api";
import { currentSessionId } from "@/lib/op112/session-key";
import type { ViewerSession } from "./results";

/** Keys of the current login session, to hide practice of other people on a shared demo account. */
export async function viewerSession(): Promise<ViewerSession> {
  return { practiceKey: await practiceKey(), sessionId: await currentSessionId() };
}
