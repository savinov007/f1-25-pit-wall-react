// Makes the rival telemetry window (#dm .dmbox) a floating popup: drag by the header, resize from the
// right edge, bottom edge or corner. Position and size are remembered in localStorage.
(() => {
  const dm = document.getElementById('dm');
  const box = dm.querySelector('.dmbox');
  const KEY = 'pitwall-popup-v1';
  const MIN_W = 380, MIN_H = 300, MARGIN = 6;

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch (err) {
      return null;
    }
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(rect));
    } catch (err) {
      // storage unavailable: position just won't persist
    }
  };

  const defaults = () => {
    const w = Math.min(Math.round(innerWidth * 0.56), 980), h = Math.min(Math.round(innerHeight * 0.72), 700);
    return {w, h, x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - h) / 2)};
  };
  let rect = load() || defaults();

  function clamp() {
    rect.w = Math.max(MIN_W, Math.min(rect.w, innerWidth - MARGIN * 2));
    rect.h = Math.max(MIN_H, Math.min(rect.h, innerHeight - MARGIN * 2));
    rect.x = Math.max(MARGIN, Math.min(rect.x, innerWidth - rect.w - MARGIN));
    rect.y = Math.max(MARGIN, Math.min(rect.y, innerHeight - rect.h - MARGIN));
  }
  function apply() {
    clamp();
    box.style.left = rect.x + 'px';
    box.style.top = rect.y + 'px';
    box.style.width = rect.w + 'px';
    box.style.height = rect.h + 'px';
  }

  function track(e, onMove) {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    document.body.classList.add('popup-drag');
    const move = ev => { onMove(ev); apply(); };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      document.body.classList.remove('popup-drag');
      save();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  box.querySelector('.dmhead').addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY, ox = rect.x, oy = rect.y;
    track(e, ev => { rect.x = ox + ev.clientX - sx; rect.y = oy + ev.clientY - sy; });
  });

  for (const h of box.querySelectorAll('.rz')) {
    h.addEventListener('pointerdown', e => {
      const edge = h.dataset.edge, sx = e.clientX, sy = e.clientY, ow = rect.w, oh = rect.h;
      track(e, ev => {
        if (edge.includes('r')) rect.w = ow + ev.clientX - sx;
        if (edge.includes('b')) rect.h = oh + ev.clientY - sy;
      });
    });
  }

  // double-click the header to restore the default size and position
  box.querySelector('.dmhead').addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    rect = defaults();
    apply();
    save();
  });

  addEventListener('resize', apply);
  apply();
})();
