export type InvoicePdfInput = {
  number: string;
  companyName: string;
  period: string;
  vehicleCount: number;
  amountCents: number;
  status: string;
  dueDate: string | null;
};

function esc(value: string) {
  return value.replace(/[\\()]/g, (ch) => `\\${ch}`).replace(/[^\x20-\x7E]/g, "?");
}

/** One-page Helvetica invoice. No paid PDF library — text the browser can download. */
export function buildInvoicePdf(inv: InvoicePdfInput): string {
  const rows: [string, string][] = [
    ["Invoice", inv.number],
    ["Billed to", inv.companyName],
    ["Period", inv.period],
    ["Vehicles", String(inv.vehicleCount)],
    ["Amount", `USD ${(inv.amountCents / 100).toFixed(2)}`],
    ["Status", inv.status],
    ["Due", inv.dueDate ?? "On receipt"],
  ];

  const ops: string[] = [];
  const text = (x: number, y: number, size: number, line: string) => {
    ops.push("BT", `/F1 ${size} Tf`, `${x} ${y} Td`, `(${esc(line)}) Tj`, "ET");
  };

  text(72, 720, 20, "Nextrel");
  text(72, 698, 11, "Fleet operations invoice");
  let y = 650;
  for (const [label, value] of rows) {
    text(72, y, 12, label);
    text(220, y, 12, value);
    y -= 24;
  }
  text(72, y - 12, 10, "Manual billing. No payment gateway on this invoice.");
  text(72, y - 28, 10, "Usage is the billed vehicle count for the period.");

  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
