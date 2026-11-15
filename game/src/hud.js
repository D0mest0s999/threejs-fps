// The DOM HUD: crosshair and hit marker, health, ammo and money readouts, the round clock
// and score across the top, a kill feed, a damage vignette, the buy menu that opens each
// round, a progress bar for planting and defusing, and the one overlay panel for the start,
// pause and match end. It never touches the simulation; main.js pushes numbers in.
const COPY = {
  start: {
    title: 'Nightshift Depot',
    copy: 'Four defenders hold the Vault. Plant the charge on the glowing plate, or drop all four. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Nightshift Depot',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const title = el('overlay-title');
  const copy = el('overlay-copy');
  const play = el('play');
  const ammo = el('ammo');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const healthFill = el('health-fill');
  const healthValue = el('health-value');
  const money = el('money');
  const timer = el('round-timer');
  const roundsUs = el('rounds-us');
  const roundsThem = el('rounds-them');
  const foes = el('foes-left');
  const hitmarker = el('hitmarker');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const progress = el('progress');
  const progressFill = el('progress-fill');
  const progressLabel = el('progress-label');
  const buy = el('buy');
  const feed = el('feed');
  const vignette = el('vignette');
  const hint = el('hint');
  let hitTimer = 0;
  let bannerTimer = 0;
  let vignetteTimer = 0;
  const last = { mag: -1, reserve: -1, name: '', health: -1, money: -1, timer: '', us: -1, them: -1, foes: -1 };

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = String(value);
  }

  return {
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', mag);
      setText(weaponName, 'name', name);
      if (last.reserve !== reserve) {
        last.reserve = reserve;
        ammoReserve.textContent = `/ ${reserve}`;
      }
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(value) {
      const clamped = Math.max(0, Math.round(value));
      if (last.health === clamped) return;
      last.health = clamped;
      healthValue.textContent = String(clamped);
      healthFill.style.width = `${clamped}%`;
      healthFill.classList.toggle('low', clamped <= 30);
    },
    setMoney(value) {
      setText(money, 'money', `$${value}`);
    },
    setTimer(text, urgent) {
      setText(timer, 'timer', text);
      timer.classList.toggle('urgent', Boolean(urgent));
    },
    setRounds(us, them) {
      setText(roundsUs, 'us', us);
      setText(roundsThem, 'them', them);
    },
    setFoes(count) {
      setText(foes, 'foes', `${count} DEFENDERS LEFT`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => vignette.classList.remove('on'), 160);
    },
    banner(big, small, holdMs = 2600) {
      bannerTitle.textContent = big;
      bannerSub.textContent = small ?? '';
      bannerEl.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => bannerEl.classList.remove('on'), holdMs);
    },
    showProgress(label, fraction) {
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    },
    hideProgress() {
      progress.hidden = true;
    },
    showBuy(rows) {
      buy.hidden = false;
      for (const row of buy.querySelectorAll('[data-buy]')) {
        const info = rows[row.dataset.buy];
        if (!info) continue;
        row.classList.toggle('owned', Boolean(info.owned));
        row.classList.toggle('poor', !info.owned && !info.affordable);
        row.querySelector('.buy-state').textContent = info.owned ? 'OWNED' : info.affordable ? `$${info.price}` : `$${info.price} — CAN'T AFFORD`;
      }
    },
    hideBuy() {
      buy.hidden = true;
    },
    feed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      feed.appendChild(line);
      while (feed.children.length > 5) feed.removeChild(feed.firstChild);
      setTimeout(() => line.classList.add('stale'), 4000);
      setTimeout(() => line.remove(), 5200);
    },
    hint(text) {
      hint.textContent = text ?? '';
      hint.classList.toggle('on', Boolean(text));
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end' && detail ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
