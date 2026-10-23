// Draggable dividers between dashboard sections. Sizes are kept as flex weights (px at drag time),
// so they scale with the window, and are remembered in localStorage.
(() => {
  const KEY = 'pitwall-layout-v1';
  const MIN = {x: 220, y: 110};
  const STEP = 24;
  const desktop = matchMedia('(min-width: 1000px)');

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (err) {
      return {};
    }
  };
  const save = sizes => {
    try {
      localStorage.setItem(KEY, JSON.stringify(sizes));
    } catch (err) {
      // storage unavailable: layout just won't persist
    }
  };

  const panes = () => [...document.querySelectorAll('main > .col, .col > .card')];
  const setFlex = (el, px) => { el.style.flex = `${px} 1 0`; };

  function applySaved() {
    const sizes = load();
    for (const el of panes()) {
      if (sizes[el.id]) setFlex(el, sizes[el.id]);
    }
  }
  function clearInline() {
    for (const el of panes()) el.style.flex = '';
  }
  function sync() {
    if (desktop.matches) applySaved();
    else clearInline();
  }

  function remember(...els) {
    const sizes = load();
    for (const el of els) {
      const px = parseFloat(el.style.flex);
      if (px) sizes[el.id] = px;
    }
    save(sizes);
  }

  // Freeze every pane in the group at its current size, so px weights stay comparable to each other.
  function freeze(split) {
    const horizontal = split.dataset.dir === 'x';
    const group = [...split.parentElement.children].filter(el => el.id && !el.classList.contains('split'));
    // read every size before writing any, or each write reflows the layout under the next read
    const sizes = group.map(el => {
      const r = el.getBoundingClientRect();
      return horizontal ? r.width : r.height;
    });
    group.forEach((el, i) => setFlex(el, sizes[i]));
    return group;
  }

  function measure(split) {
    const a = split.previousElementSibling, b = split.nextElementSibling;
    const horizontal = split.dataset.dir === 'x';
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const sa = horizontal ? ra.width : ra.height, sb = horizontal ? rb.width : rb.height;
    return {a, b, horizontal, sa, total: sa + sb, min: MIN[split.dataset.dir]};
  }
  function resize(m, size) {
    const na = Math.min(m.total - m.min, Math.max(m.min, size));
    setFlex(m.a, na);
    setFlex(m.b, m.total - na);
  }

  for (const split of document.querySelectorAll('.split')) {
    split.addEventListener('pointerdown', e => {
      if (!desktop.matches) return;
      e.preventDefault();
      const group = freeze(split);
      const m = measure(split);
      const start = m.horizontal ? e.clientX : e.clientY;
      split.setPointerCapture(e.pointerId);
      split.classList.add('drag');
      document.body.classList.add(m.horizontal ? 'resizing-x' : 'resizing-y');
      const move = ev => resize(m, m.sa + (m.horizontal ? ev.clientX : ev.clientY) - start);
      const up = () => {
        split.removeEventListener('pointermove', move);
        split.removeEventListener('pointerup', up);
        split.removeEventListener('pointercancel', up);
        split.classList.remove('drag');
        document.body.classList.remove('resizing-x', 'resizing-y');
        remember(...group);
      };
      split.addEventListener('pointermove', move);
      split.addEventListener('pointerup', up);
      split.addEventListener('pointercancel', up);
    });

    split.addEventListener('keydown', e => {
      const horizontal = split.dataset.dir === 'x';
      const dir = {ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1}[e.key];
      if (!dir || (horizontal && e.key.endsWith('Up')) || (horizontal && e.key.endsWith('Down')) ||
          (!horizontal && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return;
      e.preventDefault();
      const group = freeze(split);
      const m = measure(split);
      resize(m, m.sa + dir * STEP);
      remember(...group);
    });
  }

  document.getElementById('resetLayout').onclick = () => {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {
      // nothing to clear
    }
    clearInline();
  };

  desktop.addEventListener('change', sync);
  sync();
})();
