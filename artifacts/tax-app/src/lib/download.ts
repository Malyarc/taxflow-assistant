/** Trigger a browser download for a same-origin file URL (PDF / CSV / etc.). */
export function downloadFile(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
