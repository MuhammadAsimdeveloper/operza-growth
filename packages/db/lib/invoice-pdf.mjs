import { fromCents } from './money.mjs';

function escapePdfText(text) {
  return String(text ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function formatMoney(cents, currency = 'USD') {
  const val = fromCents(Number(cents) || 0).toFixed(2);
  return `${String(currency || 'USD').toUpperCase()} ${val}`;
}

/**
 * Generates a valid PDF 1.4 document buffer from authoritative persisted invoice data.
 * Pure Node.js implementation with deterministic xref offsets.
 */
export function generateInvoicePdf(invoice = {}) {
  const number = invoice.number || invoice.invoiceNumber || 'INV-DRAFT';
  const agencyName = invoice.agencyName || 'Operza Agency';
  const contactName = invoice.contactName || 'Customer';
  const currency = invoice.currency || 'USD';
  const status = String(invoice.status || 'draft').toUpperCase();
  const amountCents = invoice.amountCents !== undefined
    ? Number(invoice.amountCents)
    : Math.round((Number(invoice.amount) || 0) * 100);
  const paidCents = invoice.paidCents !== undefined
    ? Number(invoice.paidCents)
    : (status === 'PAID' ? amountCents : 0);
  const discountCents = Number(invoice.discountCents) || 0;
  const taxCents = Number(invoice.taxCents) || 0;
  const dueDate = invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : 'Upon Receipt';

  const lines = [
    { text: agencyName, size: 18, y: 750 },
    { text: `INVOICE ${number}`, size: 14, y: 724 },
    { text: `Status: ${status}   |   Due Date: ${dueDate}`, size: 10, y: 704 },
    { text: `Bill To: ${contactName}`, size: 11, y: 680 },
    { text: '--------------------------------------------------------------------', size: 10, y: 660 },
    { text: 'Description                                      Qty       Amount', size: 10, y: 644 }
  ];

  let y = 624;
  const items = Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0
    ? invoice.lineItems
    : [{ description: invoice.description || 'Services Rendered', quantity: 1, unitPriceCents: amountCents }];

  for (const item of items.slice(0, 20)) {
    const desc = String(item.description || item.name || 'Item').slice(0, 44).padEnd(46, ' ');
    const qty = String(Number(item.quantity) || 1).padStart(3, ' ');
    const unitCents = item.unitPriceCents !== undefined
      ? Number(item.unitPriceCents)
      : Math.round((Number(item.unitPrice ?? item.price ?? 0)) * 100);
    const lineCents = unitCents * (Number(item.quantity) || 1);
    const amt = formatMoney(lineCents, currency).padStart(14, ' ');
    lines.push({ text: `${desc}${qty}${amt}`, size: 9, y });
    y -= 18;
  }

  y -= 10;
  lines.push({ text: '--------------------------------------------------------------------', size: 10, y });
  y -= 18;
  if (discountCents > 0) {
    lines.push({ text: `Discount: -${formatMoney(discountCents, currency)}`, size: 10, y });
    y -= 16;
  }
  if (taxCents > 0) {
    lines.push({ text: `Tax: ${formatMoney(taxCents, currency)}`, size: 10, y });
    y -= 16;
  }
  lines.push({ text: `Total: ${formatMoney(amountCents, currency)}`, size: 12, y });
  y -= 18;
  lines.push({ text: `Paid: ${formatMoney(paidCents, currency)}   |   Balance Due: ${formatMoney(Math.max(0, amountCents - paidCents), currency)}`, size: 10, y });

  const streamOps = lines
    .map(l => `BT /F1 ${l.size} Tf 50 ${l.y} Td (${escapePdfText(l.text)}) Tj ET`)
    .join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamOps, 'latin1')} >>\nstream\n${streamOps}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
