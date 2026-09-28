/**
 * Typing time of a 112 card against the norm of the lesson — «Карточка сохранена за 3:15 при нормативе 1:05».
 * The check keeps the time and the norm (`timing`): within the norm it earns all its points, past it fewer the
 * longer the card took, down to none at the zero point of the weights (timeCredit in src/lib/scoring/score.ts),
 * so 1:06 is not punished like 3:15. Pure: the workstation's review and the demo lessons build the check here.
 */
import type { CriterionResult } from "@/lib/scoring/score";

function mmss(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** `done` — what was done by then: «Карточка сохранена», «Пустая карточка закрыта». */
export function typingTimeCheck(done: string, seconds: number, normSec: number): CriterionResult {
  const sec = Math.max(0, Math.round(seconds));
  const over = sec - normSec;
  return {
    code: "op112.typing_time",
    group: "timeliness",
    title: `${done} за ${mmss(sec)} при нормативе ${mmss(normSec)}`,
    ok: over <= 0,
    evidence: over > 0 ? `Дольше норматива на ${mmss(over)}, таймер покраснел` : `В нормативе, таймер не покраснел${over < 0 ? `: запас ${mmss(-over)}` : ""}`,
    expected: over > 0 ? `сохранить не позже ${mmss(normSec)}, пока таймер не покраснел` : undefined,
    timing: { sec, normSec },
    source: "rule",
  };
}
