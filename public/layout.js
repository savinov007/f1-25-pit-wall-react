// Dashboard layout: which sections go in which column (arranged in the Layout dialog by drag and drop), and
// draggable dividers between them. Sizes are kept as flex weights (px at drag time), so they scale with the window.
// Both are remembered in localStorage.
(() => {
  const KEY = 'pitwall-layout-v1'; // sizes: element id -> flex weight
  const ARRANGE_KEY = 'pitwall-arrangement-v1'; // {cols: [[section id, ...], ...]}
  const MIN = {x: 220, y: 110};
  const STEP = 24;
  const DRAG_PX = 4; // pointer travel before a press on a section becomes a drag
  const desktop = matchMedia('(min-width: 1000px)');
  const {MAX_COLS, normalizeArrangement, moveSection} = PitLib;
  const $ = id => document.getElementById(id);

  const read = key => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (err) {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // storage unavailable: the layout just won't persist
    }
  };
  const load = () => read(KEY) || {};
  const save = sizes => write(KEY, sizes);

  // --- Sections and their arrangement ---
  const main = document.querySelector('main');
  const sections = new Map([...main.querySelectorAll('.col > .card')].map(el => [el.id, el]));
  const ids = [...sections.keys()];
  // the page's own markup is the default arrangement
  const DEFAULT = {cols: [...main.children].map(col => [...col.children].map(el => el.id))};
  const title = id => sections.get(id).querySelector('h2 span').textContent.trim();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let current = normalizeArrangement(read(ARRANGE_KEY), ids, DEFAULT);

  // --- Sizes ---
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

  // A divider between two columns (dir 'x') or two sections in a column (dir 'y').
  function makeSplit(dir) {
    const split = document.createElement('div');
    split.className = 'split';
    split.dataset.dir = dir;
    split.setAttribute('role', 'separator');
    split.setAttribute('aria-orientation', dir === 'x' ? 'vertical' : 'horizontal');
    split.setAttribute('aria-label', dir === 'x' ? 'Resize columns' : 'Resize sections');
    split.tabIndex = 0;

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
      const horizontal = dir === 'x';
      const step = {ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1}[e.key];
      if (!step || (horizontal && e.key.endsWith('Up')) || (horizontal && e.key.endsWith('Down')) ||
          (!horizontal && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return;
      e.preventDefault();
      const group = freeze(split);
      const m = measure(split);
      resize(m, m.sa + step * STEP);
      remember(...group);
    });
    return split;
  }

  // Lay the dashboard out: columns c1..cN with dividers between them and between their sections. The section
  // elements themselves are moved, never rebuilt, so everything the page wired to them keeps working.
  function build(arr) {
    const nodes = [];
    arr.cols.forEach((list, i) => {
      if (i) nodes.push(makeSplit('x'));
      const col = document.createElement('div');
      col.className = 'col';
      col.id = 'c' + (i + 1);
      list.forEach((id, k) => {
        if (k) col.append(makeSplit('y'));
        col.append(sections.get(id));
      });
      nodes.push(col);
    });
    main.replaceChildren(...nodes);
    sync();
  }

  // --- Layout dialog: drag sections between columns ---
  const dialog = $('lo'), grid = $('loGrid');
  let draft = null; // the arrangement being edited, with empty columns allowed
  let drag = null;

  function openLayout() {
    draft = {cols: current.cols.map(c => [...c])};
    $('loSizes').checked = false;
    render();
    dialog.hidden = false;
    const first = grid.querySelector('.lotile');
    if (first) first.focus();
  }
  function closeLayout() {
    endDrag();
    dialog.hidden = true;
    draft = null;
  }
  function saveLayout() {
    const next = normalizeArrangement(draft, ids, DEFAULT);
    // a new arrangement starts from even sizes: weights saved for the old columns would no longer fit
    if (!same(next, current) || $('loSizes').checked) {
      save(null);
      clearInline();
    }
    current = next;
    write(ARRANGE_KEY, same(current, DEFAULT) ? null : current);
    build(current);
    closeLayout();
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function render(focusId) {
    grid.style.setProperty('--n', draft.cols.length);
    grid.replaceChildren(...draft.cols.map((list, ci) => {
      const col = el('div', 'locol');
      col.dataset.col = ci;
      const head = el('div', 'lohead', `Column ${ci + 1}`);
      if (!list.length && draft.cols.length > 1) {
        const remove = el('button', 'lorm', '✕');
        remove.type = 'button';
        remove.title = 'Remove this empty column';
        remove.setAttribute('aria-label', `Remove column ${ci + 1}`);
        remove.onclick = () => {
          draft.cols.splice(ci, 1);
          render();
        };
        head.append(remove);
      }
      col.append(head);
      list.forEach((id, k) => col.append(tile(id, ci, k, list.length)));
      if (!list.length) col.append(el('div', 'loempty', 'Drop a section here'));
      return col;
    }));
    $('loAddCol').disabled = draft.cols.length >= MAX_COLS;
    $('loDefault').disabled = same(normalizeArrangement(draft, ids, DEFAULT), DEFAULT);
    if (focusId) grid.querySelector(`.lotile[data-id="${focusId}"]`).focus();
  }

  function tile(id, ci, k, n) {
    const t = el('div', 'lotile');
    t.dataset.id = id;
    t.tabIndex = 0;
    t.setAttribute('role', 'button');
    t.setAttribute('aria-roledescription', 'movable section');
    t.setAttribute('aria-label', `${title(id)}: column ${ci + 1} of ${draft.cols.length}, position ${k + 1} of ${n}. Arrow keys move it.`);
    t.append(el('span', 'logrip', '⋮⋮'), el('span', 'loname', title(id)));
    t.addEventListener('pointerdown', e => startDrag(e, t));
    t.addEventListener('keydown', e => keyMove(e, id));
    return t;
  }

  // Arrow keys: up/down within the column, left/right to the neighbouring column (at the same height or below).
  function keyMove(e, id) {
    const ci = draft.cols.findIndex(c => c.includes(id));
    const k = draft.cols[ci].indexOf(id);
    const to = {
      ArrowUp: [ci, k - 1], ArrowDown: [ci, k + 1],
      ArrowLeft: [ci - 1, k], ArrowRight: [ci + 1, k],
    }[e.key];
    if (!to) return;
    e.preventDefault();
    const [col, index] = to;
    if (col < 0 || col >= draft.cols.length || index < 0 || (col === ci && index >= draft.cols[ci].length)) return;
    draft = moveSection(draft, id, col, index);
    render(id);
  }

  // Where a section dropped at (x, y) lands: the column under the pointer (or the nearest), before the first
  // section whose middle is below the pointer. The index counts the column without the dragged section.
  function dropTarget(x, y, id) {
    const cols = [...grid.querySelectorAll('.locol')];
    let col = 0, best = Infinity;
    cols.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < best) { best = d; col = i; }
    });
    const tiles = [...cols[col].querySelectorAll('.lotile')].filter(t => t.dataset.id !== id);
    const index = tiles.findIndex(t => {
      const r = t.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return {col, index: index < 0 ? tiles.length : index, before: tiles[index] || null, colEl: cols[col]};
  }

  function startDrag(e, t) {
    if (e.button > 0 || drag) return;
    drag = {t, id: t.dataset.id, x: e.clientX, y: e.clientY, moving: false, ghost: null, mark: null, target: null};
    t.setPointerCapture(e.pointerId);
    t.addEventListener('pointermove', onDragMove);
    t.addEventListener('pointerup', onDragEnd);
    t.addEventListener('pointercancel', endDrag);
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
      drag.moving = true;
      drag.t.classList.add('dragging');
      drag.ghost = el('div', 'loghost', title(drag.id));
      drag.mark = el('div', 'lodrop');
      document.body.append(drag.ghost);
      document.body.classList.add('lodragging');
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    drag.target = dropTarget(e.clientX, e.clientY, drag.id);
    // show where it lands: a marker before the section it would go above, or at the end of the column
    const {colEl, before} = drag.target;
    if (before) colEl.insertBefore(drag.mark, before);
    else colEl.insertBefore(drag.mark, colEl.querySelector('.loempty'));
  }
  function onDragEnd() {
    const d = drag;
    endDrag();
    if (d && d.moving && d.target) {
      draft = moveSection(draft, d.id, d.target.col, d.target.index);
      render(d.id);
    }
  }
  function endDrag() {
    if (!drag) return;
    const {t, ghost, mark} = drag;
    t.removeEventListener('pointermove', onDragMove);
    t.removeEventListener('pointerup', onDragEnd);
    t.removeEventListener('pointercancel', endDrag);
    t.classList.remove('dragging');
    if (ghost) ghost.remove();
    if (mark) mark.remove();
    document.body.classList.remove('lodragging');
    drag = null;
  }

  $('layoutBtn').onclick = openLayout;
  $('loClose').onclick = closeLayout;
  $('loCancel').onclick = closeLayout;
  $('loSave').onclick = saveLayout;
  $('loAddCol').onclick = () => { // disabled at MAX_COLS (render)
    draft.cols.push([]);
    render();
  };
  $('loDefault').onclick = () => {
    draft = {cols: DEFAULT.cols.map(c => [...c])};
    render();
  };
  dialog.addEventListener('pointerdown', e => { if (e.target === dialog) closeLayout(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dialog.hidden) closeLayout(); });

  desktop.addEventListener('change', sync);
  build(current);
})();
