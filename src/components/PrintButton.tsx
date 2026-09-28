"use client";

/**
 * «Печать / PDF»: the browser's print dialog, where «Сохранить как PDF» gives an A4 file. The cabinet menu and the
 * buttons are hidden by the print styles (src/app/globals.css, `print:hidden`); no PDF library is needed.
 */
export function PrintButton({ label = "🖨 Распечатать", className = "" }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded border border-arm-gray bg-white px-4 text-sm font-medium text-arm-dark hover:bg-arm-panel print:hidden ${className}`}
    >
      {label}
    </button>
  );
}
