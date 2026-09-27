"use client";

/** «Распечатать»: the memo prints without the cabinet menu (print styles hide it). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center gap-1.5 rounded border border-arm-gray bg-white px-4 text-sm font-medium text-arm-dark hover:bg-arm-panel print:hidden"
    >
      🖨 Распечатать
    </button>
  );
}
