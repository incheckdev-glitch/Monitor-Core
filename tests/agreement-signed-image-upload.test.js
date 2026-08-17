const assert = require('assert');
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
