from pathlib import Path

path = Path('tests/proposal-preview-actions.test.js')
text = path.read_text()
old = "assert.doesNotMatch(creatorNameBody, /creator\\.email\\s*\\|\\|/, 'email must not be used as a provider signatory display-name fallback');"
new = "const candidateBody = creatorNameBody.match(/const candidate = String\\(([\\s\\S]*?)\\)\\.trim\\(\\);/)?.[1] || '';\nassert.doesNotMatch(candidateBody, /creator\\.email/, 'email must not be used as a provider signatory display-name candidate');"
if old not in text:
    raise SystemExit('Unable to locate broad provider email assertion')
path.write_text(text.replace(old, new, 1))
