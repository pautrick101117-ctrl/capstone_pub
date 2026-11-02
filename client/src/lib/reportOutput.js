import { API_URL } from './api';
import { formatDateTime } from './format';

export const downloadReport = async (type, filters, token) => {
  const query = new URLSearchParams({...filters,format:'xlsx'});
  const response = await fetch(`${API_URL}/admin/reports/${encodeURIComponent(type)}?${query}`, {headers:{Authorization:`Bearer ${token}`}});
  if (!response.ok) {
    const payload = await response.json().catch(()=>({}));
    throw new Error(payload.message || 'Unable to export this report.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href=url;
  link.download=`barangay-${type}-report.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
};

export const printReport = (report) => {
  const popup = window.open('', '_blank', 'width=1200,height=800');
  if (!popup) throw new Error('Allow pop-ups to open the printable report.');
  popup.opener=null;
  const doc=popup.document;
  doc.title=`Barangay Iba — ${report.title}`;
  doc.body.replaceChildren();
  const style=doc.createElement('style');
  style.textContent='@page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#1c1917}h1{font-size:20px}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}p{margin:6px 0}';
  doc.head.appendChild(style);
  const heading=doc.createElement('h1');
  heading.textContent=`Barangay Iba — ${report.title}`;
  const details=doc.createElement('p');
  details.textContent=`Period: ${report.from || 'All dates'} to ${report.to || 'All dates'} (Philippine time) · ${report.total} records`;
  const generated=doc.createElement('p');
  generated.textContent=`Generated: ${formatDateTime(report.generatedAt)}`;
  const table=doc.createElement('table');
  const head=table.createTHead().insertRow();
  for (const label of report.columns) {const cell=doc.createElement('th');cell.textContent=label;head.appendChild(cell);}
  const body=table.createTBody();
  for (const row of report.rows) {
    const tr=body.insertRow();
    for (const value of row) tr.insertCell().textContent=String(value ?? '');
  }
  doc.body.append(heading,details,generated,table);
  popup.requestAnimationFrame(()=>{popup.focus();popup.print();});
  return popup;
};

