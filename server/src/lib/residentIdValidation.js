export const MAX_ID_FILES = 5;
export const MAX_ID_BYTES = 5 * 1024 * 1024;

export const identifyImage = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return ['image/jpeg','jpg'];
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return ['image/png','png'];
  if (buffer.subarray(0,4).toString('ascii') === 'RIFF' && buffer.subarray(8,12).toString('ascii')==='WEBP') return ['image/webp','webp'];
  return null;
};

const inputError = (message) => Object.assign(new Error(message), { status: 400 });
export const validateIdFiles = (files, rawMetadata, types=[]) => {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_ID_FILES) throw inputError('Upload between 1 and 5 valid ID images.');
  let meta;
  try { meta = JSON.parse(rawMetadata || '[]'); } catch { throw inputError('Invalid ID document details.'); }
  if (!Array.isArray(meta) || meta.length !== files.length) throw inputError('Select a document type for every ID image.');
  return files.map((file, index) => {
    const validated = identifyImage(file.buffer);
    if (!validated || file.mimetype !== validated[0] || file.size > MAX_ID_BYTES || file.size < 100)
      throw inputError('Each ID must be a real JPG, PNG or WebP image, up to 5 MB.');
    const chosen = meta[index] || {};
    const type = types.find((t) => t.id === chosen.typeId && t.is_active);
    const custom = chosen.typeId === 'custom' ? `${chosen.customLabel || ''}`.trim() : '';
    if (!type && (!custom || custom.length < 2 || custom.length > 80 || /[<>]/.test(custom)))
      throw inputError('Choose a valid ID type or enter a custom document name (2–80 characters).');
    return { file, mime: validated[0], ext: validated[1], document_type_id: type?.id || null,
      document_label: type?.label || custom };
  });
};
