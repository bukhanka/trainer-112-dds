/**
 * The paper of this page when printed or saved as PDF: A4 turned sideways for a wide report or a certificate. The
 * default (A4 portrait) is in src/app/globals.css; this rule comes later in the document and wins while the page is open.
 */
export function PrintPage({ landscape = false }: { landscape?: boolean }) {
  return <style>{`@media print { @page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: ${landscape ? "10mm" : "12mm"}; } }`}</style>;
}
