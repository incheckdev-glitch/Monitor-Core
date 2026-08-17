from pathlib import Path

p = Path('agreements.js')
s = p.read_text()
marker = "  async uploadSignedAgreementDocument() {\n"
helper = r'''  async normalizeSignedAgreementUploadFile(file) {
    if (!file) throw new Error('Choose a signed agreement document to upload.');
    const type = String(file.type || '').trim().toLowerCase();
    const name = String(file.name || 'signed-agreement').trim();
    const lowerName = name.toLowerCase();
    if (type === 'application/pdf' || lowerName.endsWith('.pdf')) return file;

    const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
    const supportedImageExtension = /\.(png|jpe?g|webp)$/i.test(lowerName);
    if (!supportedImageTypes.has(type) && !supportedImageExtension) {
      throw new Error('Signed agreement document must be a PDF, PNG, JPG, JPEG, or WEBP file.');
    }

    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) throw new Error('Image-to-PDF converter is unavailable. Refresh the page and try again.');

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Unable to read the selected image.'));
        img.src = objectUrl;
      });
      const sourceWidth = Number(image.naturalWidth || image.width || 0);
      const sourceHeight = Number(image.naturalHeight || image.height || 0);
      if (!sourceWidth || !sourceHeight) throw new Error('The selected image has invalid dimensions.');

      const maxDimension = 2400;
      const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Unable to prepare the selected image for PDF conversion.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpegData = canvas.toDataURL('image/jpeg', 0.92);

      const orientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
      const pdf = new JsPdf({ orientation, unit: 'pt', format: 'a4', compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 24;
      const fit = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2) / canvas.height);
      const drawWidth = canvas.width * fit;
      const drawHeight = canvas.height * fit;
      const x = (pageWidth - drawWidth) / 2;
      const y = (pageHeight - drawHeight) / 2;
      pdf.addImage(jpegData, 'JPEG', x, y, drawWidth, drawHeight, undefined, 'FAST');
      const blob = pdf.output('blob');
      const baseName = name.replace(/\.[^.]+$/, '') || 'signed-agreement';
      return new File([blob], `${baseName}.pdf`, { type: 'application/pdf', lastModified: Date.now() });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  },
'''
if 'async normalizeSignedAgreementUploadFile(file)' not in s:
    if marker not in s:
        raise SystemExit('upload method marker missing')
    s = s.replace(marker, helper + marker, 1)

old = "    const file = elements.file?.files?.[0];\n    if (!file) { UI.toast('Choose a signed agreement document to upload.'); return; }"
new = "    const selectedFile = elements.file?.files?.[0];\n    if (!selectedFile) { UI.toast('Choose a signed agreement document to upload.'); return; }\n    let file = selectedFile;"
if old in s:
    s = s.replace(old, new, 1)
elif 'const selectedFile = elements.file?.files?.[0];' not in s:
    raise SystemExit('agreement file selection block missing')

old_try = "    this.setFormBusy(true);\n    try {"
# Scope the replacement to the upload method only.
upload_pos = s.find('  async uploadSignedAgreementDocument() {')
if upload_pos < 0:
    raise SystemExit('upload method missing after helper insert')
try_pos = s.find(old_try, upload_pos)
if try_pos < 0:
    raise SystemExit('agreement upload try block missing')
if 'file = await this.normalizeSignedAgreementUploadFile(selectedFile);' not in s[upload_pos:upload_pos+5000]:
    replacement = "    this.setFormBusy(true);\n    try {\n      file = await this.normalizeSignedAgreementUploadFile(selectedFile);"
    s = s[:try_pos] + s[try_pos:].replace(old_try, replacement, 1)

old_input = '<input id="agreementSignedDocumentFile" class="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" aria-label="Signed agreement document" />'
new_input = '<input id="agreementSignedDocumentFile" class="input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" aria-label="Signed agreement document" />'
if old_input in s:
    s = s.replace(old_input, new_input, 1)
elif new_input not in s:
    raise SystemExit('signed agreement file input missing')

p.write_text(s)

idx = Path('index.html')
h = idx.read_text()
old_key = '/agreements.js?v=20260810-agreement-00096-00113-blank-signatory-v38'
new_key = '/agreements.js?v=20260817-signed-image-upload-v1'
if old_key in h:
    h = h.replace(old_key, new_key, 1)
elif new_key not in h:
    raise SystemExit('agreement cache key missing')
idx.write_text(h)

Path('tests/agreement-signed-image-upload.test.js').write_text(r'''const assert = require('assert');
const fs = require('fs');
const agreements = fs.readFileSync('agreements.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const storage = fs.readFileSync('database/bootstrap/01_storage_buckets.sql', 'utf8');

assert(agreements.includes('async normalizeSignedAgreementUploadFile(file)'), 'agreement image-to-PDF normalizer missing');
assert(agreements.includes("type === 'application/pdf'"), 'agreement PDF passthrough missing');
assert(agreements.includes("new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])"), 'agreement image MIME support missing');
assert(agreements.includes('/\\.(png|jpe?g|webp)$/i.test(lowerName)'), 'agreement image extension fallback missing');
assert(agreements.includes("new File([blob], `${baseName}.pdf`"), 'converted agreement upload must be a PDF File');
assert(agreements.includes('file = await this.normalizeSignedAgreementUploadFile(selectedFile);'), 'agreement upload must normalize selected images');
assert(agreements.includes('accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"'), 'agreement picker must advertise supported PDF/image formats only');
assert(!agreements.includes('accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"'), 'agreement picker must not advertise unsupported DOC/DOCX');
assert(index.includes('/agreements.js?v=20260817-signed-image-upload-v1'), 'agreement script cache key must be bumped');
assert(storage.includes("('agreement-signed-documents','agreement-signed-documents',false,10485760,array['application/pdf']::text[])"), 'agreement bucket must remain PDF-only');
console.log('Agreement signed image upload checks passed.');
''')
