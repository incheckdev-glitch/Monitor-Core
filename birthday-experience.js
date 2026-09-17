(function installKhaledBirthdayExperience(global) {
  'use strict';

  const OVERLAY_ID = 'khaledBirthdayOverlay';
  const ENHANCED_ATTR = 'data-birthday-experience-enhanced';
  const COLORS = ['#2563eb', '#60a5fa', '#f43f5e', '#f59e0b', '#22c55e', '#a855f7', '#ec4899'];

  function installStyles() {
    if (document.getElementById('khaledBirthdayExperienceStyle')) return;
    const style = document.createElement('style');
    style.id = 'khaledBirthdayExperienceStyle';
    style.textContent = `
      @keyframes birthdaySparkle { 0%,100%{transform:scale(.65) rotate(0);opacity:.25} 50%{transform:scale(1.25) rotate(25deg);opacity:1} }
      @keyframes birthdayGiftBounce { 0%,100%{transform:translateY(0) rotate(0)} 35%{transform:translateY(-7px) rotate(-3deg)} 70%{transform:translateY(-3px) rotate(3deg)} }
      @keyframes birthdaySmoke { 0%{transform:translateY(0) scale(.5);opacity:.65} 100%{transform:translateY(-22px) scale(1.5);opacity:0} }
      @keyframes birthdayFinalePiece { 0%{transform:translate(-50%,-50%) translate(0,0) scale(.4);opacity:1} 100%{transform:translate(-50%,-50%) translate(var(--fx),var(--fy)) scale(1);opacity:0} }
      @keyframes birthdayFinaleConfetti { 0%{transform:translate3d(0,-12vh,0) rotate(0);opacity:1} 100%{transform:translate3d(var(--fd),112vh,0) rotate(var(--fr));opacity:.1} }
      @keyframes birthdayBannerIn { from{transform:translateX(-50%) translateY(-120%);opacity:0} to{transform:translateX(-50%) translateY(0);opacity:1} }
      @keyframes birthdayPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.035)} }

      #khaledBirthdayCelebrationBanner {
        position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;
        max-width:min(720px,calc(100vw - 28px));padding:10px 18px;border-radius:999px;
        background:linear-gradient(90deg,#1d4ed8,#2563eb,#3b82f6);color:#fff;
        box-shadow:0 12px 35px rgba(37,99,235,.32);font:800 13px/1.1 Inter,system-ui,sans-serif;
        letter-spacing:.02em;text-align:center;animation:birthdayBannerIn .38s ease-out both;pointer-events:none;
      }
      #${OVERLAY_ID} .khaled-birthday-card{max-height:92vh;overflow:auto!important}
      #${OVERLAY_ID} .birthday-title-wrap{position:relative;display:inline-block;padding:0 20px}
      #${OVERLAY_ID} .birthday-sparkle{position:absolute;font-size:17px;line-height:1;animation:birthdaySparkle 1.25s ease-in-out infinite;pointer-events:none}
      #${OVERLAY_ID} .birthday-sparkle.s1{left:0;top:-8px}.birthday-sparkle.s2{right:0;top:8px;animation-delay:.25s}
      #${OVERLAY_ID} .birthday-sparkle.s3{left:10px;bottom:-13px;animation-delay:.5s}.birthday-sparkle.s4{right:14px;bottom:-10px;animation-delay:.75s}

      #${OVERLAY_ID} .birthday-progress-panel{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:13px auto 0;max-width:470px}
      #${OVERLAY_ID} .birthday-chip{border:1px solid rgba(37,99,235,.16);background:#f8fbff;color:#334155;border-radius:999px;padding:7px 10px;font:750 11px/1 Inter,system-ui,sans-serif}
      #${OVERLAY_ID} .birthday-chip.done{background:#ecfdf5;color:#047857;border-color:rgba(16,185,129,.22)}
      #${OVERLAY_ID} .birthday-chip.active{background:#eff6ff;color:#1d4ed8;border-color:rgba(37,99,235,.28);animation:birthdayPulse 1.5s ease-in-out infinite}

      #${OVERLAY_ID} .birthday-mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0 0}
      #${OVERLAY_ID} .birthday-panel{border:1px solid rgba(37,99,235,.14);border-radius:18px;background:rgba(248,251,255,.95);padding:12px;min-height:132px;display:flex;flex-direction:column;justify-content:center;align-items:center}
      #${OVERLAY_ID} .birthday-panel-title{font:800 12px/1.2 Inter,system-ui,sans-serif;color:#334155;margin-bottom:8px}

      #${OVERLAY_ID} .birthday-cake{position:relative;width:132px;height:73px;margin-top:18px}
      #${OVERLAY_ID} .birthday-cake-base{position:absolute;left:10px;right:10px;bottom:0;height:52px;border-radius:12px 12px 18px 18px;background:linear-gradient(#fbbf24 0 28%,#f9a8d4 29% 58%,#fff1f2 59%);box-shadow:0 8px 20px rgba(190,24,93,.16)}
      #${OVERLAY_ID} .birthday-cake-base::before{content:'';position:absolute;left:0;right:0;top:-6px;height:14px;border-radius:50%;background:#fff7ed;border:1px solid rgba(251,146,60,.18)}
      #${OVERLAY_ID} .birthday-candles{position:absolute;left:20px;right:20px;top:-9px;display:flex;justify-content:space-around;align-items:flex-end}
      #${OVERLAY_ID} .birthday-candle{position:relative;width:6px;height:31px;border-radius:3px;background:repeating-linear-gradient(45deg,#2563eb 0 4px,#fff 4px 8px)}
      #${OVERLAY_ID} .birthday-flame{position:absolute;left:50%;top:-13px;width:10px;height:14px;border-radius:60% 45% 55% 45%;transform:translateX(-50%) rotate(8deg);background:radial-gradient(circle at 50% 65%,#fde68a 0 25%,#f59e0b 35% 70%,#ef4444 72%);box-shadow:0 0 12px rgba(245,158,11,.75);transition:opacity .2s,transform .2s}
      #${OVERLAY_ID} .birthday-candle.is-out .birthday-flame{opacity:0;transform:translateX(-50%) translateY(3px) scale(.35)}
      #${OVERLAY_ID} .birthday-candle.is-out::after{content:'•';position:absolute;left:50%;top:-10px;color:#94a3b8;font-size:18px;animation:birthdaySmoke 1.4s ease-out infinite}

      #${OVERLAY_ID} .birthday-action{border:0;border-radius:11px;padding:8px 11px;background:#2563eb;color:#fff;font:750 11px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 15px rgba(37,99,235,.18)}
      #${OVERLAY_ID} .birthday-action.secondary{background:#fff;color:#1d4ed8;border:1px solid rgba(37,99,235,.22);box-shadow:none}
      #${OVERLAY_ID} .birthday-action:disabled{opacity:.55;cursor:default}

      #${OVERLAY_ID} .birthday-gift{font-size:56px;line-height:1;cursor:pointer;user-select:none;animation:birthdayGiftBounce 1.8s ease-in-out infinite;filter:drop-shadow(0 8px 9px rgba(15,23,42,.14))}
      #${OVERLAY_ID} .birthday-gift.opened{animation:none;transform:scale(1.03)}
      #${OVERLAY_ID} .birthday-gift-message{display:none;margin-top:7px;font:700 11px/1.4 Inter,system-ui,sans-serif;color:#475569;max-width:190px}
      #${OVERLAY_ID} .birthday-gift-message.show{display:block}

      #${OVERLAY_ID} .birthday-toolbar{display:flex;justify-content:center;gap:7px;flex-wrap:wrap;margin-top:12px}
      #${OVERLAY_ID} #khaledBirthdayFloatingSound{position:absolute;right:14px;top:14px;z-index:5;border:1px solid rgba(37,99,235,.2);background:rgba(255,255,255,.92);width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:17px;box-shadow:0 8px 20px rgba(15,23,42,.12)}
      #${OVERLAY_ID} #khaledBirthdaySongToggle{display:none!important}

      #${OVERLAY_ID} .birthday-count{font-weight:850;color:#1d4ed8}
      #${OVERLAY_ID}.birthday-photo-mode{background:radial-gradient(circle at 50% 30%,rgba(59,130,246,.26),transparent 46%),#06152e!important}
      #${OVERLAY_ID}.birthday-photo-mode .khaled-birthday-card{width:min(720px,96vw)!important;transform:scale(1.03);box-shadow:0 40px 100px rgba(0,0,0,.5)!important}
      #${OVERLAY_ID}.birthday-photo-mode .birthday-toolbar,#${OVERLAY_ID}.birthday-photo-mode #khaledBirthdayClose,#${OVERLAY_ID}.birthday-photo-mode #khaledBirthdayFloatingSound,#${OVERLAY_ID}.birthday-photo-mode .birthday-progress-panel{display:none!important}
      #${OVERLAY_ID} #birthdayExitPhotoMode{display:none;position:fixed;right:18px;bottom:18px;z-index:2147483647;border:0;border-radius:999px;padding:11px 15px;background:#fff;color:#0f172a;font:800 12px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 12px 30px rgba(0,0,0,.28)}
      #${OVERLAY_ID}.birthday-photo-mode #birthdayExitPhotoMode{display:block}

      #${OVERLAY_ID} .birthday-finale-piece{position:absolute;left:var(--px);top:var(--py);width:8px;height:8px;border-radius:50%;background:var(--pc);box-shadow:0 0 12px var(--pc);animation:birthdayFinalePiece 1.05s cubic-bezier(.1,.75,.2,1) forwards;pointer-events:none;z-index:4}
      #${OVERLAY_ID} .birthday-finale-confetti{position:absolute;top:-18px;left:var(--cl);width:8px;height:14px;border-radius:2px;background:var(--cc);animation:birthdayFinaleConfetti var(--cd) linear forwards;pointer-events:none;z-index:4}
      #${OVERLAY_ID} .birthday-finale-message{position:absolute;left:50%;top:15%;transform:translateX(-50%);z-index:5;padding:12px 18px;border-radius:999px;background:rgba(255,255,255,.95);color:#1d4ed8;box-shadow:0 18px 40px rgba(15,23,42,.2);font:900 14px/1 Inter,system-ui,sans-serif;white-space:nowrap;animation:birthdayBannerIn .3s ease-out both}

      @media(max-width:620px){
        #${OVERLAY_ID} .khaled-birthday-card{padding:28px 17px 20px!important;max-height:88vh;overflow:auto!important}
        #${OVERLAY_ID} .birthday-mini-grid{grid-template-columns:1fr 1fr}
        #${OVERLAY_ID} .birthday-panel{min-height:120px;padding:9px}
        #${OVERLAY_ID} .birthday-cake{transform:scale(.88);margin-top:13px;margin-bottom:-4px}
        #khaledBirthdayCelebrationBanner{top:7px;font-size:11px;padding:8px 13px}
      }
      @media(prefers-reduced-motion:reduce){
        #${OVERLAY_ID} .birthday-sparkle,#${OVERLAY_ID} .birthday-gift,#${OVERLAY_ID} .birthday-finale-piece,#${OVERLAY_ID} .birthday-finale-confetti{animation:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function addBanner() {
    if (document.getElementById('khaledBirthdayCelebrationBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'khaledBirthdayCelebrationBanner';
    banner.textContent = '🎉 Today we celebrate Khaled — Happy Birthday! 🎂';
    document.body.appendChild(banner);
  }

  function removeBanner() {
    document.getElementById('khaledBirthdayCelebrationBanner')?.remove();
  }

  function enhanceOverlay(overlay) {
    if (!overlay || overlay.getAttribute(ENHANCED_ATTR) === 'true') return;
    const card = overlay.querySelector('.khaled-birthday-card');
    const title = overlay.querySelector('#khaledBirthdayTitle');
    const closeButton = overlay.querySelector('#khaledBirthdayClose');
    if (!card || !title || !closeButton) return;

    overlay.setAttribute(ENHANCED_ATTR, 'true');
    installStyles();
    addBanner();

    const titleWrap = document.createElement('div');
    titleWrap.className = 'birthday-title-wrap';
    title.parentNode.insertBefore(titleWrap, title);
    titleWrap.appendChild(title);
    ['s1','s2','s3','s4'].forEach((cls, idx) => {
      const s = document.createElement('span');
      s.className = `birthday-sparkle ${cls}`;
      s.textContent = idx % 2 ? '✦' : '✨';
      s.setAttribute('aria-hidden', 'true');
      titleWrap.appendChild(s);
    });

    let poppedCount = 0;
    let totalBalloons = 0;
    let candlesDone = false;
    let giftDone = false;
    let finaleDone = false;
    let finaleSeconds = 20;
    let finaleTimer = null;

    const instruction = [...card.querySelectorAll('p')].find(p => /Tap the balloons/i.test(p.textContent || ''));
    if (instruction) instruction.innerHTML = 'Pop the balloons, blow the candles, and open your gift 🎈🎂🎁';

    const progress = document.createElement('div');
    progress.className = 'birthday-progress-panel';
    progress.innerHTML = `
      <span id="birthdayBalloonChip" class="birthday-chip active">🎈 <span class="birthday-count">0 / 0</span> popped</span>
      <span id="birthdayCandleChip" class="birthday-chip">🎂 Blow candles</span>
      <span id="birthdayGiftChip" class="birthday-chip">🎁 Open gift</span>
      <span id="birthdayTimerChip" class="birthday-chip">🎆 Finale in <span id="birthdayFinaleSeconds">20</span>s</span>
    `;
    (instruction || closeButton).insertAdjacentElement('afterend', progress);

    const miniGrid = document.createElement('div');
    miniGrid.className = 'birthday-mini-grid';
    miniGrid.innerHTML = `
      <section class="birthday-panel" aria-label="Birthday cake">
        <div class="birthday-panel-title">Make a wish ✨</div>
        <div class="birthday-cake" aria-hidden="true">
          <div class="birthday-cake-base"></div>
          <div class="birthday-candles">
            ${Array.from({length:5}, () => '<span class="birthday-candle"><span class="birthday-flame"></span></span>').join('')}
          </div>
        </div>
        <button id="birthdayBlowCandles" type="button" class="birthday-action">💨 Blow Candles</button>
      </section>
      <section class="birthday-panel" aria-label="Birthday gift">
        <div class="birthday-panel-title">A gift for you</div>
        <div id="birthdayGiftBox" class="birthday-gift" role="button" tabindex="0" aria-label="Open birthday gift">🎁</div>
        <div id="birthdayGiftMessage" class="birthday-gift-message">Another year of ideas, progress and achievements. Keep building what matters. 🎉</div>
      </section>
    `;
    progress.insertAdjacentElement('afterend', miniGrid);

    const toolbar = document.createElement('div');
    toolbar.className = 'birthday-toolbar';
    toolbar.innerHTML = `
      <button id="birthdayPhotoMode" type="button" class="birthday-action secondary">📸 Photo Mode</button>
      <button id="birthdayReplayFinale" type="button" class="birthday-action secondary">🎆 Fireworks</button>
    `;
    miniGrid.insertAdjacentElement('afterend', toolbar);

    const exitPhoto = document.createElement('button');
    exitPhoto.id = 'birthdayExitPhotoMode';
    exitPhoto.type = 'button';
    exitPhoto.textContent = 'Exit Photo Mode';
    overlay.appendChild(exitPhoto);

    const floatingSound = document.createElement('button');
    floatingSound.id = 'khaledBirthdayFloatingSound';
    floatingSound.type = 'button';
    floatingSound.setAttribute('aria-label', 'Toggle birthday music');
    floatingSound.title = 'Birthday music';
    floatingSound.textContent = '🔊';
    card.appendChild(floatingSound);

    function syncSoundButton() {
      const source = document.getElementById('khaledBirthdaySongToggle');
      if (!source) return;
      const text = source.textContent || '';
      floatingSound.textContent = /Stop/i.test(text) ? '🔊' : '🔈';
      floatingSound.title = /Stop/i.test(text) ? 'Mute birthday music' : 'Play birthday music';
    }
    floatingSound.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const source = document.getElementById('khaledBirthdaySongToggle');
      if (source) source.click();
      global.setTimeout(syncSoundButton, 80);
    });
    const soundObserver = new MutationObserver(syncSoundButton);
    soundObserver.observe(card, {childList:true,subtree:true,characterData:true});
    global.setTimeout(syncSoundButton, 200);

    function updateProgress() {
      const count = overlay.querySelector('.birthday-count');
      if (count) count.textContent = `${poppedCount} / ${totalBalloons}`;
      const balloonChip = overlay.querySelector('#birthdayBalloonChip');
      if (balloonChip) {
        const completed = totalBalloons > 0 && poppedCount >= totalBalloons;
        balloonChip.classList.toggle('done', completed);
        balloonChip.classList.toggle('active', !completed);
      }
      overlay.querySelector('#birthdayCandleChip')?.classList.toggle('done', candlesDone);
      overlay.querySelector('#birthdayGiftChip')?.classList.toggle('done', giftDone);
    }

    function countNewBalloons() {
      overlay.querySelectorAll('.khaled-balloon').forEach(balloon => {
        if (balloon.dataset.birthdayChallengeTracked === '1') return;
        balloon.dataset.birthdayChallengeTracked = '1';
        totalBalloons += 1;
      });
      updateProgress();
    }
    countNewBalloons();

    const balloonObserver = new MutationObserver(countNewBalloons);
    balloonObserver.observe(overlay, {childList:true,subtree:true});

    overlay.addEventListener('pointerdown', event => {
      const balloon = event.target?.closest?.('.khaled-balloon');
      if (!balloon || balloon.dataset.birthdayChallengePopped === '1') return;
      balloon.dataset.birthdayChallengePopped = '1';
      poppedCount += 1;
      updateProgress();
      if (totalBalloons > 0 && poppedCount >= totalBalloons) runFinale('All balloons popped! 🎈💥');
    }, true);

    function createBurst(xPercent, yPercent, pieces = 30) {
      for (let i = 0; i < pieces; i += 1) {
        const piece = document.createElement('span');
        piece.className = 'birthday-finale-piece';
        const angle = (Math.PI * 2 * i) / pieces + Math.random() * .12;
        const distance = 70 + Math.random() * 120;
        piece.style.setProperty('--px', `${xPercent}%`);
        piece.style.setProperty('--py', `${yPercent}%`);
        piece.style.setProperty('--fx', `${Math.cos(angle) * distance}px`);
        piece.style.setProperty('--fy', `${Math.sin(angle) * distance}px`);
        piece.style.setProperty('--pc', COLORS[(i + Math.floor(Math.random()*COLORS.length)) % COLORS.length]);
        overlay.appendChild(piece);
        global.setTimeout(() => piece.remove(), 1300);
      }
    }

    function finaleConfetti(count = 110) {
      for (let i = 0; i < count; i += 1) {
        const c = document.createElement('span');
        c.className = 'birthday-finale-confetti';
        c.style.setProperty('--cl', `${Math.random()*100}%`);
        c.style.setProperty('--cc', COLORS[i % COLORS.length]);
        c.style.setProperty('--cd', `${3 + Math.random()*2.7}s`);
        c.style.setProperty('--fd', `${Math.round(Math.random()*260-130)}px`);
        c.style.setProperty('--fr', `${Math.round(Math.random()*1100-550)}deg`);
        overlay.appendChild(c);
        global.setTimeout(() => c.remove(), 6200);
      }
    }

    function runFinale(message = 'Happy Birthday Khaled! 🎉') {
      if (!overlay.isConnected) return;
      if (finaleDone && message !== 'Fireworks encore! 🎆') return;
      finaleDone = true;
      if (finaleTimer) global.clearInterval(finaleTimer);
      const timerChip = overlay.querySelector('#birthdayTimerChip');
      if (timerChip) {
        timerChip.classList.add('done');
        timerChip.textContent = '🎆 Finale!';
      }
      createBurst(16, 24, 28);
      createBurst(84, 22, 28);
      global.setTimeout(() => createBurst(50, 15, 34), 220);
      global.setTimeout(() => createBurst(27, 47, 30), 520);
      global.setTimeout(() => createBurst(74, 45, 30), 760);
      global.setTimeout(() => createBurst(50, 64, 38), 1080);
      finaleConfetti();
      const label = document.createElement('div');
      label.className = 'birthday-finale-message';
      label.textContent = message;
      overlay.appendChild(label);
      global.setTimeout(() => label.remove(), 3300);
    }

    const candlesButton = overlay.querySelector('#birthdayBlowCandles');
    candlesButton?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (candlesDone) return;
      candlesDone = true;
      overlay.querySelectorAll('.birthday-candle').forEach((candle, index) => {
        global.setTimeout(() => candle.classList.add('is-out'), index * 90);
      });
      candlesButton.textContent = '✨ Wish Made!';
      candlesButton.disabled = true;
      updateProgress();
      global.setTimeout(() => createBurst(50, 40, 18), 350);
    });

    function openGift() {
      if (giftDone) return;
      giftDone = true;
      const box = overlay.querySelector('#birthdayGiftBox');
      const message = overlay.querySelector('#birthdayGiftMessage');
      if (box) { box.textContent = '🎊'; box.classList.add('opened'); box.setAttribute('aria-label','Birthday gift opened'); }
      message?.classList.add('show');
      updateProgress();
      createBurst(73, 58, 20);
    }
    const gift = overlay.querySelector('#birthdayGiftBox');
    gift?.addEventListener('click', openGift);
    gift?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openGift(); }
    });

    const photoButton = overlay.querySelector('#birthdayPhotoMode');
    photoButton?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      overlay.classList.add('birthday-photo-mode');
      removeBanner();
    });
    exitPhoto.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      overlay.classList.remove('birthday-photo-mode');
      addBanner();
    });

    overlay.querySelector('#birthdayReplayFinale')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const old = finaleDone;
      finaleDone = false;
      runFinale(old ? 'Fireworks encore! 🎆' : 'Happy Birthday Khaled! 🎉');
    });

    finaleTimer = global.setInterval(() => {
      finaleSeconds -= 1;
      const target = overlay.querySelector('#birthdayFinaleSeconds');
      if (target) target.textContent = String(Math.max(0, finaleSeconds));
      if (finaleSeconds <= 0) {
        global.clearInterval(finaleTimer);
        finaleTimer = null;
        runFinale('Happy Birthday Khaled! 🎉');
      }
    }, 1000);

    global.setTimeout(() => createBurst(20, 30, 16), 1200);
    global.setTimeout(() => createBurst(80, 30, 16), 1800);

    const cleanupObserver = new MutationObserver(() => {
      if (document.getElementById(OVERLAY_ID)) return;
      if (finaleTimer) global.clearInterval(finaleTimer);
      balloonObserver.disconnect();
      soundObserver.disconnect();
      cleanupObserver.disconnect();
      removeBanner();
    });
    cleanupObserver.observe(document.body, {childList:true,subtree:true});
  }

  function findAndEnhance() {
    enhanceOverlay(document.getElementById(OVERLAY_ID));
  }

  const observer = new MutationObserver(findAndEnhance);
  const start = () => {
    installStyles();
    findAndEnhance();
    observer.observe(document.body, {childList:true,subtree:true});
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})(window);
