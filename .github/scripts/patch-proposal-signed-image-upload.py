from pathlib import Path

p = Path('proposals.js')
s = p.read_text()
marker = "  async uploadSignedProposalDocument() {\n"
helper = r'''  async normalizeSignedProposalUploadFile(file) {
    if (!file) throw new Error('Choose a signed proposal document to upload.');
    const type = String(file.type || '').trim().toLowerCase();
    const name = String(file.name || 'signed-proposal').trim();
    if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return file;
    const supportedImages = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
    if (!supportedImages.has(type)) {
      throw new Error('Signed proposal document must be a PDF, PNG, JPG, JPEG, or WEBP file.');
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
      const baseName = name.replace(/\.[^.]+$/, '') || 'signed-proposal';
      return new File([blob], `${baseName}.pdf`, { type: 'application/pdf', lastModified: Date.now() });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  },
'''
if helper.strip() not in s:
    if marker not in s: raise SystemExit('upload method marker missing')
    s = s.replace(marker, helper + marker, 1)
old = "    const file = E.proposalSignedDocumentFile?.files?.[0];\n    if (!file) { UI.toast('Choose a signed proposal document to upload.'); return; }"
new = "    const selectedFile = E.proposalSignedDocumentFile?.files?.[0];\n    if (!selectedFile) { UI.toast('Choose a signed proposal document to upload.'); return; }\n    let file = selectedFile;"
if old not in s: raise SystemExit('file selection block missing')
s = s.replace(old,new,1)
old_try = "    this.setFormBusy(true);\n    try {\n      const { data: latestProposal, error: latestError } = await client"
new_try = "    this.setFormBusy(true);\n    try {\n      file = await this.normalizeSignedProposalUploadFile(selectedFile);\n      const { data: latestProposal, error: latestError } = await client"
if old_try not in s: raise SystemExit('try marker missing')
s = s.replace(old_try,new_try,1)
p.write_text(s)

idx = Path('index.html')
h = idx.read_text()
lib_marker = '  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>'
lib = lib_marker + '\n  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>'
if 'jspdf.umd.min.js' not in h:
    if lib_marker not in h: raise SystemExit('library marker missing')
    h = h.replace(lib_marker, lib, 1)
old_input = '<input id="proposalSignedDocumentFile" class="input" type="file" aria-label="Signed proposal document" />'
new_input = '<input id="proposalSignedDocumentFile" class="input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" aria-label="Signed proposal document" />'
if old_input not in h: raise SystemExit('signed document input missing')
h = h.replace(old_input,new_input,1)
old_key = '/proposals.js?v=20260817-proposal-preview-actions-v1'
new_key = '/proposals.js?v=20260817-signed-image-upload-v1'
if old_key not in h: raise SystemExit('proposal cache key missing')
h = h.replace(old_key,new_key,1)
idx.write_text(h)

Path('tests/proposal-signed-image-upload.test.js').write_text(r'''const assert = require('assert');
const fs = require('fs');
const proposals = fs.readFileSync('proposals.js','utf8');
const index = fs.readFileSync('index.html','utf8');
assert(proposals.includes('async normalizeSignedProposalUploadFile(file)'), 'image-to-PDF normalizer missing');
assert(proposals.includes("type === 'application/pdf'"), 'PDF passthrough missing');
assert(proposals.includes("new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])"), 'image MIME support missing');
assert(proposals.includes("new File([blob], `${baseName}.pdf`"), 'converted upload must be a real PDF File');
assert(proposals.includes('file = await this.normalizeSignedProposalUploadFile(selectedFile);'), 'upload path must normalize selected image');
assert(index.includes('jspdf@2.5.2/dist/jspdf.umd.min.js'), 'jsPDF browser library missing');
assert(index.includes('accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"'), 'signed proposal file picker must accept images');
assert(index.includes('/proposals.js?v=20260817-signed-image-upload-v1'), 'proposal cache key must be bumped');
console.log('Proposal signed image upload checks passed.');
''')
