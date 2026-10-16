import { deflateRawSync } from 'node:zlib';

// Minimal native Office Open XML writer. Creates genuine .xlsx files without a
// network-installed dependency. Values are inline strings, never executable formulas.
const xml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const safeCell = (v) => {
  const str = String(v ?? '');
  return /^[\s]*[=+\-@]/.test(str) ? `'${str}` : str;
};
const colName = (i) => {
  let text = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text;
  return text;
};
const sheetXml = (rows, widths = []) => {
  const table = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ''}>${row.map((value, columnIndex) =>
    `<c r="${colName(columnIndex)}${rowIndex + 1}" s="${rowIndex === 0 ? 1 : rowIndex % 2 ? 0 : 2}" t="inlineStr"><is><t xml:space="preserve">${xml(safeCell(value))}</t></is></c>`).join('')}</row>`).join('');
  const columns = widths.map((width, i) => `<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('');
  const lastColumn = colName((rows[0] || []).length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${table}</sheetData><autoFilter ref="A1:${lastColumn}${rows.length}"/></worksheet>`;
};
const crc32 = (buf) => {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (~crc) >>> 0;
};
const zipFiles = (entries) => {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, body] of Object.entries(entries)) {
    const fileName = Buffer.from(name, 'utf8');
    const source = Buffer.from(body, 'utf8');
    const compressed = deflateRawSync(source);
    const checksum = crc32(source);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(source.length, 22); local.writeUInt16LE(fileName.length, 26);
    locals.push(local, fileName, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(source.length, 24); central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42); centrals.push(central, fileName);
    offset += local.length + fileName.length + compressed.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(entries).length;
  eocd.writeUInt16LE(count, 8); eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralBytes.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
};

const summaryHeader = ['Event ID','Date & Time (UTC)','Category','Action','Outcome','Module','Actor','Actor Role','Target Type','Target ID','Target Name','Source','IP Address','Method','Route','Correlation ID','User Agent','Details (JSON)','Before Snapshot (JSON)','After Snapshot (JSON)','Changed Fields (JSON)'];
const changeHeader = ['Event ID','Date & Time (UTC)','Module','Action','Actor','Target Type','Target ID','Field','Before','After'];
const pretty = (value) => value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export const auditReportRows = (logs) => {
  const summary = [summaryHeader];
  const changes = [changeHeader];
  for (const log of logs) {
    summary.push([log.id, log.created_at, log.event_category || 'legacy', log.action, log.outcome, log.module,
      log.actor_name_snapshot || log.actor_name || '', log.actor_role, log.entity_type, log.entity_id,
      log.target_label, log.event_source, log.ip_address, log.http_method, log.route, log.correlation_id,
      log.user_agent, pretty(log.details), pretty(log.before_data), pretty(log.after_data), pretty(log.changed_fields)]);
    if (log.event_category !== 'change' && !log.changed_fields && !log.before_data && !log.after_data) continue;
    const fields = log.changed_fields && typeof log.changed_fields === 'object' ? log.changed_fields
      : Object.fromEntries([...new Set([...Object.keys(log.before_data || {}), ...Object.keys(log.after_data || {})])].map((key) => [key, { before: log.before_data?.[key], after: log.after_data?.[key] }]));
    for (const [field, diff] of Object.entries(fields)) {
      changes.push([log.id, log.created_at, log.module, log.action, log.actor_name_snapshot || log.actor_name || '',
        log.entity_type, log.entity_id, field,
        pretty(diff && typeof diff === 'object' && 'before' in diff ? diff.before : log.before_data?.[field]),
        pretty(diff && typeof diff === 'object' && 'after' in diff ? diff.after : log.after_data?.[field])]);
    }
  }
  return { summary, changes };
};

export const createAuditWorkbook = (logs) => {
  const { summary, changes } = auditReportRows(logs);
  return zipFiles({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Event Summary" sheetId="1" r:id="rId1"/><sheet name="Field Changes" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF266A33"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F7F0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': sheetXml(summary, [38,26,16,35,15,24,26,18,25,38,35,18,24,16,35,38,42,55,55,55]),
    'xl/worksheets/sheet2.xml': sheetXml(changes, [38,26,24,35,26,24,38,28,50,50]),
  });
};
