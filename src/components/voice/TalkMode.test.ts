/** «Голос / Текст»: the default follows what the trainee can do, a choice wins, and nothing is spoken before it is known. */
import { describe, expect, it } from "vitest";
import { resolveTalkMode } from "./TalkMode";

describe("talk mode", () => {
  it("is «Голос» when the trainee can talk by voice, «Текст» when not", () => {
    expect(resolveTalkMode(null, true)).toEqual({ mode: "voice", settled: true });
    expect(resolveTalkMode(null, false)).toEqual({ mode: "text", settled: true });
  });

  it("keeps the trainee's choice whatever the capabilities", () => {
    expect(resolveTalkMode("text", true)).toEqual({ mode: "text", settled: true });
    expect(resolveTalkMode("voice", false)).toEqual({ mode: "voice", settled: true });
    expect(resolveTalkMode("text", undefined)).toEqual({ mode: "text", settled: true });
  });

  it("is not settled while the capabilities load: the first line waits instead of being skipped", () => {
    expect(resolveTalkMode(null, undefined)).toEqual({ mode: "voice", settled: false });
  });
});
