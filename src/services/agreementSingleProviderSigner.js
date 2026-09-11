(function installAgreementSingleProviderSigner(global) {
  'use strict';

  const VERSION = '20260911-agreement-single-provider-signer1';

  function hideFieldRow(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const row = el.closest('.filter-row') || el.parentElement;
    if (row) row.style.display = 'none';
  }

  function apply() {
    const firstName = document.getElementById('agreementFormProviderOfficialSignatory1Name');
    if (!firstName) return false;

    const providerColumn = firstName.closest('.signatory-column');
    if (!providerColumn) return false;

    const heading = providerColumn.querySelector('h4');
    if (heading) heading.textContent = 'Provider Official Signatory';

    const subtitles = Array.from(providerColumn.querySelectorAll('.agreement-signature-subtitle'));
    if (subtitles[0]) subtitles[0].textContent = 'General Manager';
    if (subtitles[1]) subtitles[1].style.display = 'none';

    hideFieldRow('agreementFormProviderOfficialSignatory2Name');
    hideFieldRow('agreementFormProviderOfficialSignatory2Title');
    hideFieldRow('agreementFormProviderOfficialSignatory2SignDate');

    const firstNameEl = document.getElementById('agreementFormProviderOfficialSignatory1Name');
    const firstTitleEl = document.getElementById('agreementFormProviderOfficialSignatory1Title');
    if (firstNameEl && !String(firstNameEl.value || '').trim()) firstNameEl.value = 'Hanna Khattar';
    if (firstTitleEl && !String(firstTitleEl.value || '').trim()) firstTitleEl.value = 'General Manager';

    providerColumn.dataset.singleProviderSignerVersion = VERSION;
    return true;
  }

  function install() {
    apply();

    const observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    document.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('#agreementsTab, [data-view="agreements"], [data-agreement-view], [data-agreement-edit]')) {
        requestAnimationFrame(apply);
        setTimeout(apply, 100);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window);
