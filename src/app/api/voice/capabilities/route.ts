import { apiUser } from "@/lib/auth/session";

/** Which voice services the server has; the browser fills the gaps with its own recogniser and voices. */
export async function GET() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  return Response.json({ stt: !!process.env.STT_BASE_URL, tts: !!process.env.TTS_BASE_URL });
}
