// offscreen/offscreen.js
// Runs inside an offscreen document (which has full Web Audio API access,
// unlike the service worker). background.js creates this document the first
// time it needs a sound, then just sends a message for every subsequent alert.

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PLAY_ALERT_SOUND') {
    playAlert();
  }
});

function playAlert() {
  try {
    const ctx = new AudioContext();

    // Two descending tones — classic "warning" sound.
    // First tone: high (880 Hz), second tone: lower (550 Hz), slight delay between.
    const tones = [
      { freq: 880, startAt: 0,    duration: 0.18 },
      { freq: 550, startAt: 0.20, duration: 0.22 }
    ];

    tones.forEach(({ freq, startAt, duration }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;

      // Quick fade-in then smooth fade-out so it's alerting but not jarring
      const t0 = ctx.currentTime + startAt;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

      osc.start(t0);
      osc.stop(t0 + duration);
    });

    // Close the AudioContext a bit after the last tone finishes to free resources.
    setTimeout(() => ctx.close(), 800);
  } catch (err) {
    // AudioContext may fail in some environments — silently ignore.
    console.warn('Mission Control: could not play alert sound', err);
  }
}
