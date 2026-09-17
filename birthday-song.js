(function installKhaledBirthdaySong(global) {
  'use strict';

  const OVERLAY_ID = 'khaledBirthdayOverlay';
  const ATTACHED_ATTR = 'data-birthday-song-attached';
  let audioContext = null;
  let activeNodes = [];
  let isPlaying = false;
  let playbackToken = 0;
  let autoplayTimers = [];

  const NOTE_FREQUENCIES = {
    G4: 392.00,
    A4: 440.00,
    B4: 493.88,
    C5: 523.25,
    D5: 587.33,
    E5: 659.25,
    F5: 698.46,
    G5: 783.99
  };

  // Instrumental “Happy Birthday to You”.
  const MELODY = [
    ['G4', .30], ['G4', .16], ['A4', .46], ['G4', .46], ['C5', .46], ['B4', .78],
    ['G4', .30], ['G4', .16], ['A4', .46], ['G4', .46], ['D5', .46], ['C5', .78],
    ['G4', .30], ['G4', .16], ['G5', .46], ['E5', .46], ['C5', .46], ['B4', .46], ['A4', .78],
    ['F5', .30], ['F5', .16], ['E5', .46], ['C5', .46], ['D5', .46], ['C5', .92]
  ];

  function getAudioContext() {
    if (audioContext && audioContext.state !== 'closed') return audioContext;
    const AudioCtor = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtor) return null;
    audioContext = new AudioCtor({ latencyHint: 'interactive' });
    return audioContext;
  }

  function clearAutoplayTimers() {
    autoplayTimers.forEach(timer => global.clearTimeout(timer));
    autoplayTimers = [];
  }

  function stopSong() {
    playbackToken += 1;
    clearAutoplayTimers();
    activeNodes.forEach(node => {
      try { node.stop?.(); } catch (_) {}
      try { node.disconnect?.(); } catch (_) {}
    });
    activeNodes = [];
    isPlaying = false;
    const button = document.getElementById('khaledBirthdaySongToggle');
    if (button) {
      button.textContent = '🔊 Replay Birthday Song';
      button.setAttribute('aria-pressed', 'false');
    }
  }

  async function playSong() {
    if (isPlaying) return true;
    const ctx = getAudioContext();
    if (!ctx) return false;

    try {
      if (ctx.state === 'suspended') await ctx.resume();
    } catch (_) {}
    if (ctx.state !== 'running') return false;

    clearAutoplayTimers();
    playbackToken += 1;
    const token = playbackToken;
    isPlaying = true;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + 0.06);
    master.connect(ctx.destination);
    activeNodes.push(master);

    let cursor = ctx.currentTime + 0.06;
    const gap = 0.045;

    MELODY.forEach(([note, duration], index) => {
      const frequency = NOTE_FREQUENCIES[note];
      if (!frequency) return;

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index % 6 === 0 ? 'sine' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, cursor);

      const noteEnd = cursor + duration;
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(0.18, cursor + Math.min(0.045, duration / 4));
      gain.gain.setValueAtTime(0.16, Math.max(cursor + 0.05, noteEnd - 0.10));
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(cursor);
      oscillator.stop(noteEnd + 0.02);
      activeNodes.push(oscillator, gain);
      cursor = noteEnd + gap;
    });

    const button = document.getElementById('khaledBirthdaySongToggle');
    if (button) {
      button.textContent = '🔇 Stop Birthday Song';
      button.setAttribute('aria-pressed', 'true');
    }

    const remainingMs = Math.max(0, (cursor - ctx.currentTime + 0.15) * 1000);
    global.setTimeout(() => {
      if (token !== playbackToken) return;
      activeNodes.forEach(node => {
        try { node.disconnect?.(); } catch (_) {}
      });
      activeNodes = [];
      isPlaying = false;
      const currentButton = document.getElementById('khaledBirthdaySongToggle');
      if (currentButton) {
        currentButton.textContent = '🔊 Replay Birthday Song';
        currentButton.setAttribute('aria-pressed', 'false');
      }
    }, remainingMs);

    return true;
  }

  function aggressivelyTryAutoplay() {
    clearAutoplayTimers();

    const attempt = () => {
      if (isPlaying || !document.getElementById(OVERLAY_ID)) return;
      playSong().catch(() => {});
    };

    // Immediate attempt as soon as the celebration appears, followed by short retries.
    attempt();
    [80, 250, 600, 1200].forEach(delay => {
      autoplayTimers.push(global.setTimeout(attempt, delay));
    });
  }

  function attachToOverlay(overlay) {
    if (!overlay || overlay.getAttribute(ATTACHED_ATTR) === 'true') return;
    overlay.setAttribute(ATTACHED_ATTR, 'true');

    const card = overlay.querySelector('.khaled-birthday-card');
    const closeButton = overlay.querySelector('#khaledBirthdayClose');
    if (!card || !closeButton) return;

    const soundButton = document.createElement('button');
    soundButton.id = 'khaledBirthdaySongToggle';
    soundButton.type = 'button';
    soundButton.textContent = '🔊 Birthday Song';
    soundButton.setAttribute('aria-pressed', 'false');
    soundButton.style.cssText = 'margin:10px 6px 0;border:1px solid rgba(37,99,235,.24);border-radius:12px;padding:10px 14px;background:#eff6ff;color:#1d4ed8;font:700 13px/1 Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 16px rgba(37,99,235,.10);';
    closeButton.insertAdjacentElement('beforebegin', soundButton);

    soundButton.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (isPlaying) {
        stopSong();
        return;
      }
      await playSong();
    });

    // Start immediately without waiting for a click whenever the browser allows autoplay.
    aggressivelyTryAutoplay();

    // Retry on common lifecycle events that can transition Web Audio into a playable state.
    const retryOnFocus = () => {
      if (!isPlaying && document.getElementById(OVERLAY_ID)) aggressivelyTryAutoplay();
    };
    const retryOnVisibility = () => {
      if (document.visibilityState === 'visible') retryOnFocus();
    };
    global.addEventListener('focus', retryOnFocus);
    document.addEventListener('visibilitychange', retryOnVisibility);

    // Browser policy fallback: if autoplay is blocked, the first user gesture starts it immediately.
    const startOnFirstGesture = async event => {
      if (event.target?.closest?.('#khaledBirthdaySongToggle')) return;
      if (isPlaying) {
        overlay.removeEventListener('pointerdown', startOnFirstGesture, true);
        return;
      }
      const started = await playSong();
      if (started) overlay.removeEventListener('pointerdown', startOnFirstGesture, true);
    };
    overlay.addEventListener('pointerdown', startOnFirstGesture, true);

    const removalObserver = new MutationObserver(() => {
      if (document.getElementById(OVERLAY_ID)) return;
      stopSong();
      global.removeEventListener('focus', retryOnFocus);
      document.removeEventListener('visibilitychange', retryOnVisibility);
      removalObserver.disconnect();
    });
    removalObserver.observe(document.body, { childList: true, subtree: true });
  }

  function findAndAttach() {
    attachToOverlay(document.getElementById(OVERLAY_ID));
  }

  const observer = new MutationObserver(findAndAttach);
  const start = () => {
    findAndAttach();
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(window);
