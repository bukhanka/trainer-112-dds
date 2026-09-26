import { practiceKey } from "@/lib/dds/api";
import { currentSessionId } from "@/lib/op112/session-key";
import type { ViewerSession } from "./results";

/**
 * Keys of the current login session, to hide practice of other people on a shared demo account.
 * Outside a request (unit tests, scripts) there is no session: nothing is hidden.
 */
export async function viewerSession(): Promise<ViewerSession | undefined> {
  try {
    return { practiceKey: await practiceKey(), sessionId: await currentSessionId() };
  } catch {
    return undefined;
  }
}
