import { afterEach, describe, expect, it, vi } from "vitest";

// The administrator's «Модели ИИ → Выключить»: no request leaves the server, the rules answer.
const state = vi.hoisted(() => ({ on: true, counted: [] as string[] }));
vi.mock("../admin/services", () => ({ serviceOn: async () => state.on, serviceOnNow: () => state.on }));
vi.mock("../admin/usage", () => ({ countUsage: (name: string) => void state.counted.push(name) }));

const provider = await import("./provider");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  state.on = true;
  state.counted = [];
});

describe("AI models switched off by the administrator", () => {
  it("answer by the rules without a network call and count it", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://model.test/v1");
    vi.stubEnv("STT_BASE_URL", "http://model.test/v1");
    vi.stubEnv("TTS_BASE_URL", "http://model.test/v1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    state.on = false;

    expect(provider.llmConfigured()).toBe(false);
    expect(provider.sttConfigured()).toBe(false);
    expect(provider.ttsConfigured()).toBe(false);
    expect(provider.aiMode().llm).toBe("mock");
    expect(provider.aiConfig().llm).toContain("model.test"); // the panel still shows what is connected
    expect(provider.aiOffNote()).toBe("модели ИИ выключены администратором");
    expect(await provider.chat([{ role: "user", content: "Алло" }], { mock: () => "по правилам" })).toBe("по правилам");
    await expect(provider.chatJson([{ role: "user", content: "{}" }], { safeParse: () => ({ success: true, data: {} }) } as never)).rejects.toThrow(/switched off/);
    expect(await provider.speak("Алло", "female")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.counted).toEqual(["ai.rules", "ai.rules"]);
  });

  it("switched on again, call the model and count the call", async () => {
    vi.stubEnv("LLM_BASE_URL", "http://model.test/v1");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "Пожар на кухне" } }] })));
    expect(provider.aiOffNote()).toBe("модель не настроена");
    expect(await provider.chat([{ role: "user", content: "Алло" }])).toBe("Пожар на кухне");
    expect(state.counted).toEqual(["ai.chat"]);
  });
});
