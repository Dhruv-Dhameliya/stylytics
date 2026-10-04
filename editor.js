// screenshot editor
const {
  loadImageAsync, getCanvasDisplayScale, getViewportRect, redrawCanvas,
  drawArrowAnnotation, drawLineAnnotation, drawHighlightAnnotation,
  drawRectAnnotation, drawEllipseAnnotation, drawPenAnnotation,
  drawMarqueeSelectionPreview, getOpBounds, hitTestOp, hitTestHandle,
  drawPendingCropOverlay, hitTestCropHandle, downloadBlob, copyCanvasToClipboard, exportCanvas, HANDOFF_STORAGE_KEY
} = ScreenshotShared;

const state = { baseImage: null, ops: [] };
let nextOpId = 1;
let history = [];
let redoStack = [];
let domIntervals = null;
let dpr = 1;
let filenameBase = null;

let annotationTool = 'arrow';
let annotationColor = '#ef4444';
let annotationWidth = 4;
let toolBeforeEyedropper = 'arrow';
let selectedOpId = null;
let pendingCrop = null;

const canvas = document.getElementById('editor-canvas');
const canvasWrap = document.getElementById('editor-canvas-wrap');
const emptyEl = document.getElementById('editor-empty');

function showToast(message) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = document.createElement('span');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const label = document.createElement('span');
  label.textContent = message;
  toast.appendChild(icon.firstChild);
  toast.appendChild(label);
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  }, 1600);
}

function selectedOp() {
  return selectedOpId ? (state.ops.find(o => o.id === selectedOpId) || null) : null;
}

function redraw(precomputedScale) {
  redrawCanvas(canvas, state, precomputedScale, selectedOp());
  if (annotationTool === 'crop' && pendingCrop && state.baseImage) {
    const vp = getViewportRect(state);
    const scale = precomputedScale || getCanvasDisplayScale(canvas);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(-vp.x, -vp.y);
    drawPendingCropOverlay(ctx, vp, pendingCrop, scale);
    ctx.restore();
  }
}

// crop starts with the whole image selected — the starting point for a "regular crop
// editor" drag/resize instead of forcing the user to draw a box from scratch
function defaultCropRect(vp) {
  return { type: 'crop', x1: vp.x, y1: vp.y, x2: vp.x + vp.w, y2: vp.y + vp.h };
}

const CROP_MIN_SIZE = 20;

// 8-handle resize: corners adjust both axes, edge midpoints adjust one — clamped to the
// image bounds so the crop box can never extend past the actual screenshot
function applyCropResize(rect, handle, x, y, before, vp) {
  const clampX = (v) => Math.max(vp.x, Math.min(vp.x + vp.w, v));
  const clampY = (v) => Math.max(vp.y, Math.min(vp.y + vp.h, v));
  let { x1, y1, x2, y2 } = before;
  const nx = clampX(x), ny = clampY(y);
  if (handle.includes('l')) x1 = Math.min(nx, x2 - CROP_MIN_SIZE);
  if (handle.includes('r')) x2 = Math.max(nx, x1 + CROP_MIN_SIZE);
  if (handle.includes('t')) y1 = Math.min(ny, y2 - CROP_MIN_SIZE);
  if (handle.includes('b')) y2 = Math.max(ny, y1 + CROP_MIN_SIZE);
  rect.x1 = x1; rect.y1 = y1; rect.x2 = x2; rect.y2 = y2;
}

// move: translate while keeping the box fully inside the image
function applyCropTranslate(rect, before, dx, dy, vp) {
  const w = before.x2 - before.x1, h = before.y2 - before.y1;
  const x1 = Math.max(vp.x, Math.min(vp.x + vp.w - w, before.x1 + dx));
  const y1 = Math.max(vp.y, Math.min(vp.y + vp.h - h, before.y1 + dy));
  rect.x1 = x1; rect.y1 = y1; rect.x2 = x1 + w; rect.y2 = y1 + h;
}

function updateUndoRedoButtons() {
  document.getElementById('undo-btn').disabled = history.length === 0;
  document.getElementById('redo-btn').disabled = redoStack.length === 0;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// history
function pushOp(op) {
  op.id = nextOpId++;
  state.ops.push(op);
  history.push({ type: 'add', op });
  redoStack = [];
  redraw();
  updateUndoRedoButtons();
}

function deleteOp(id) {
  const idx = state.ops.findIndex(o => o.id === id);
  if (idx === -1) return;
  const [op] = state.ops.splice(idx, 1);
  history.push({ type: 'delete', op, index: idx });
  redoStack = [];
  if (selectedOpId === id) selectedOpId = null;
  redraw();
  updateUndoRedoButtons();
}

function recordModify(id, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  history.push({ type: 'modify', id, before, after });
  redoStack = [];
  updateUndoRedoButtons();
}

function clearSelectionIfMissing() {
  if (selectedOpId && !state.ops.some(o => o.id === selectedOpId)) selectedOpId = null;
}

function undo() {
  if (!history.length) return;
  const entry = history.pop();
  if (entry.type === 'add') {
    const idx = state.ops.findIndex(o => o.id === entry.op.id);
    if (idx !== -1) state.ops.splice(idx, 1);
  } else if (entry.type === 'delete') {
    state.ops.splice(Math.min(entry.index, state.ops.length), 0, entry.op);
  } else if (entry.type === 'modify') {
    const op = state.ops.find(o => o.id === entry.id);
    if (op) Object.assign(op, entry.before);
  }
  redoStack.push(entry);
  clearSelectionIfMissing();
  redraw();
  updateUndoRedoButtons();
}

function redo() {
  if (!redoStack.length) return;
  const entry = redoStack.pop();
  if (entry.type === 'add') {
    state.ops.push(entry.op);
  } else if (entry.type === 'delete') {
    const idx = state.ops.findIndex(o => o.id === entry.op.id);
    if (idx !== -1) state.ops.splice(idx, 1);
  } else if (entry.type === 'modify') {
    const op = state.ops.find(o => o.id === entry.id);
    if (op) Object.assign(op, entry.after);
  }
  history.push(entry);
  clearSelectionIfMissing();
  redraw();
  updateUndoRedoButtons();
}

function setActiveTool(tool) {
  annotationTool = tool;
  if (tool !== 'select') selectedOpId = null;
  if (tool === 'crop') {
    if (!pendingCrop && state.baseImage) pendingCrop = defaultCropRect(getViewportRect(state));
  } else {
    pendingCrop = null;
  }
  document.querySelectorAll('#tool-toggle .tag').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  canvasWrap.classList.toggle('tool-eyedropper', tool === 'eyedropper');
  canvasWrap.classList.toggle('tool-select', tool === 'select');
  canvasWrap.classList.toggle('tool-crop', tool === 'crop');
  const cropActions = document.getElementById('crop-actions');
  if (cropActions) cropActions.classList.toggle('hidden', tool !== 'crop');
  redraw();
}

function commitPendingCrop() {
  if (!pendingCrop) return;
  const x = Math.min(pendingCrop.x1, pendingCrop.x2);
  const y = Math.min(pendingCrop.y1, pendingCrop.y2);
  const w = Math.abs(pendingCrop.x2 - pendingCrop.x1);
  const h = Math.abs(pendingCrop.y2 - pendingCrop.y1);
  if (w < 20 || h < 20) { showToast('Crop area is too small'); return; }
  pendingCrop = null;
  pushOp({ type: 'crop', x, y, w, h });
  setActiveTool('select');
}

function cancelPendingCrop() {
  pendingCrop = null;
  setActiveTool('select');
}

// theme parity
function applyStoredTheme() {
  chrome.storage.local.get(['themeOverride'], (res) => {
    document.documentElement.setAttribute('data-theme', res.themeOverride || 'light');
  });
}

// load handoff
function loadHandoff() {
  chrome.storage.local.get([HANDOFF_STORAGE_KEY], (res) => {
    const payload = res[HANDOFF_STORAGE_KEY];
    if (!payload || !payload.imageDataUrl) {
      emptyEl.classList.remove('hidden');
      return;
    }
    chrome.storage.local.remove([HANDOFF_STORAGE_KEY]);
    loadImageAsync(payload.imageDataUrl).then(img => {
      state.baseImage = img;
      state.ops = (Array.isArray(payload.ops) ? payload.ops.slice() : []).map(op => ({ ...op, id: nextOpId++ }));
      domIntervals = payload.domIntervals || null;
      dpr = payload.dpr || 1;
      filenameBase = payload.filenameBase || null;
      canvasWrap.classList.remove('hidden');
      redraw();
      updateUndoRedoButtons();
    }).catch(() => {
      emptyEl.classList.remove('hidden');
      showToast('Could not load the captured image');
    });
  });
}

// move resize math
function applyTranslate(op, before, dx, dy) {
  if (before.type === 'pen') {
    op.points = before.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  } else if (before.type === 'text') {
    op.x = before.x + dx;
    op.y = before.y + dy;
  } else {
    op.x1 = before.x1 + dx; op.y1 = before.y1 + dy;
    op.x2 = before.x2 + dx; op.y2 = before.y2 + dy;
  }
}

function applyResizeHandle(op, handle, x, y, before) {
  if (before.type === 'pen') {
    const xs = before.points.map(p => p.x), ys = before.points.map(p => p.y);
    const bx1 = Math.min(...xs), by1 = Math.min(...ys), bx2 = Math.max(...xs), by2 = Math.max(...ys);
    const anchorX = handle === 'max' ? bx1 : bx2;
    const anchorY = handle === 'max' ? by1 : by2;
    const spanX = bx2 - bx1 || 1, spanY = by2 - by1 || 1;
    const scaleX = handle === 'max' ? (x - anchorX) / spanX : (anchorX - x) / spanX;
    const scaleY = handle === 'max' ? (y - anchorY) / spanY : (anchorY - y) / spanY;
    op.points = before.points.map(p => ({
      x: anchorX + (p.x - anchorX) * scaleX,
      y: anchorY + (p.y - anchorY) * scaleY
    }));
    return;
  }
  if (handle === 'p1') { op.x1 = x; op.y1 = y; op.x2 = before.x2; op.y2 = before.y2; }
  else { op.x1 = before.x1; op.y1 = before.y1; op.x2 = x; op.y2 = y; }
}

// pointer interactions
function setupCanvasInteractions() {
  let drawing = false;
  let startLocal = { x: 0, y: 0 };
  let dragRect = null;
  let dragScale = 1;
  let dragViewport = null;
  let penPoints = null;
  let selectDrag = null;
  let cropDrag = null;
  let pendingMoveEvent = null;
  let moveFrameRequested = false;

  const getLocalPos = (e) => {
    const rect = dragRect || canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const hitTestAllOps = (origX, origY) => {
    const ctx = canvas.getContext('2d');
    const tolerance = 8 * getCanvasDisplayScale(canvas);
    for (let i = state.ops.length - 1; i >= 0; i--) {
      const op = state.ops[i];
      if (op.type === 'crop') continue;
      if (hitTestOp(ctx, op, origX, origY, tolerance)) return op;
    }
    return null;
  };

  const drawPreviewFrame = () => {
    moveFrameRequested = false;
    const e = pendingMoveEvent;
    if (!drawing || !e) return;
    const pos = getLocalPos(e);
    const ctx = canvas.getContext('2d');

    if (annotationTool === 'select' && selectDrag) {
      const origX = pos.x + dragViewport.x, origY = pos.y + dragViewport.y;
      const op = state.ops.find(o => o.id === selectDrag.opId);
      if (!op) return;
      if (selectDrag.mode === 'move') {
        applyTranslate(op, selectDrag.before, origX - selectDrag.startOrig.x, origY - selectDrag.startOrig.y);
      } else {
        applyResizeHandle(op, selectDrag.handle, origX, origY, selectDrag.before);
      }
      redraw(dragScale);
      return;
    }

    if (annotationTool === 'crop' && cropDrag) {
      const origX = pos.x + dragViewport.x, origY = pos.y + dragViewport.y;
      if (cropDrag.mode === 'resize') {
        applyCropResize(pendingCrop, cropDrag.handle, origX, origY, cropDrag.before, dragViewport);
      } else if (cropDrag.mode === 'move') {
        applyCropTranslate(pendingCrop, cropDrag.before, origX - cropDrag.startOrig.x, origY - cropDrag.startOrig.y, dragViewport);
      } else {
        pendingCrop = { type: 'crop', x1: startLocal.x + dragViewport.x, y1: startLocal.y + dragViewport.y, x2: origX, y2: origY };
      }
      redraw(dragScale);
      return;
    }

    if (annotationTool === 'pen') {
      penPoints.push(pos);
      redraw(dragScale);
      drawPenAnnotation(ctx, { points: penPoints, color: annotationColor, width: annotationWidth }, dragScale);
      return;
    }

    redraw(dragScale);
    const previewOp = { x1: startLocal.x, y1: startLocal.y, x2: pos.x, y2: pos.y, color: annotationColor, width: annotationWidth };
    if (annotationTool === 'arrow') drawArrowAnnotation(ctx, previewOp, dragScale);
    else if (annotationTool === 'line') drawLineAnnotation(ctx, previewOp, dragScale);
    else if (annotationTool === 'highlight') drawHighlightAnnotation(ctx, previewOp, dragScale);
    else if (annotationTool === 'rect') drawRectAnnotation(ctx, previewOp, dragScale);
    else if (annotationTool === 'ellipse') drawEllipseAnnotation(ctx, previewOp, dragScale);
    else if (annotationTool === 'blur') drawMarqueeSelectionPreview(ctx, previewOp, dragScale);
  };

  canvas.onpointerdown = (e) => {
    if (!state.baseImage) return;
    if (annotationTool === 'text' || annotationTool === 'eyedropper') return;

    dragRect = canvas.getBoundingClientRect();
    dragScale = getCanvasDisplayScale(canvas);
    dragViewport = getViewportRect(state);
    startLocal = getLocalPos(e);

    if (annotationTool === 'select') {
      const origX = startLocal.x + dragViewport.x, origY = startLocal.y + dragViewport.y;
      const cur = selectedOp();
      const handle = cur ? hitTestHandle(canvas.getContext('2d'), cur, origX, origY, dragScale) : null;
      if (handle) {
        selectDrag = { mode: 'resize', handle, opId: cur.id, before: clone(cur) };
        drawing = true;
        return;
      }
      const hit = hitTestAllOps(origX, origY);
      if (hit) {
        selectedOpId = hit.id;
        selectDrag = { mode: 'move', opId: hit.id, before: clone(hit), startOrig: { x: origX, y: origY } };
        drawing = true;
        redraw();
        return;
      }
      selectedOpId = null;
      selectDrag = null;
      redraw();
      return;
    }

    if (annotationTool === 'crop') {
      const origX = startLocal.x + dragViewport.x, origY = startLocal.y + dragViewport.y;
      const ctx = canvas.getContext('2d');
      const handle = pendingCrop ? hitTestCropHandle(pendingCrop, origX, origY, dragScale) : null;
      if (handle) {
        cropDrag = { mode: 'resize', handle, before: clone(pendingCrop) };
      } else if (pendingCrop && hitTestOp(ctx, pendingCrop, origX, origY, 0)) {
        cropDrag = { mode: 'move', before: clone(pendingCrop), startOrig: { x: origX, y: origY } };
      } else {
        cropDrag = { mode: 'draw', before: pendingCrop ? clone(pendingCrop) : null };
      }
      drawing = true;
      return;
    }

    drawing = true;
    if (annotationTool === 'pen') penPoints = [startLocal];
  };

  canvas.onpointermove = (e) => {
    if (!drawing) return;
    pendingMoveEvent = e;
    if (!moveFrameRequested) {
      moveFrameRequested = true;
      requestAnimationFrame(drawPreviewFrame);
    }
  };

  canvas.onpointerup = (e) => {
    if (!drawing) return;
    drawing = false;

    if (annotationTool === 'select') {
      if (selectDrag) {
        const op = state.ops.find(o => o.id === selectDrag.opId);
        if (op) recordModify(op.id, selectDrag.before, clone(op));
      }
      selectDrag = null;
      redraw();
      return;
    }

    if (annotationTool === 'crop') {
      if (cropDrag && cropDrag.mode === 'draw' && pendingCrop) {
        const x1 = Math.min(pendingCrop.x1, pendingCrop.x2), x2 = Math.max(pendingCrop.x1, pendingCrop.x2);
        const y1 = Math.min(pendingCrop.y1, pendingCrop.y2), y2 = Math.max(pendingCrop.y1, pendingCrop.y2);
        if (x2 - x1 < CROP_MIN_SIZE || y2 - y1 < CROP_MIN_SIZE) {
          pendingCrop = cropDrag.before || defaultCropRect(dragViewport);
        } else {
          pendingCrop.x1 = x1; pendingCrop.y1 = y1; pendingCrop.x2 = x2; pendingCrop.y2 = y2;
        }
      }
      cropDrag = null;
      redraw();
      return;
    }

    const pos = getLocalPos(e);
    const vp = dragViewport;

    if (annotationTool === 'pen') {
      if (penPoints.length < 2) { redraw(); return; }
      const points = penPoints.map(p => ({ x: p.x + vp.x, y: p.y + vp.y }));
      penPoints = null;
      pushOp({ type: 'pen', points, color: annotationColor, width: annotationWidth });
      return;
    }

    const movedEnough = Math.abs(pos.x - startLocal.x) >= 4 || Math.abs(pos.y - startLocal.y) >= 4;
    if (!movedEnough) { redraw(); return; }

    const x1 = startLocal.x + vp.x, y1 = startLocal.y + vp.y;
    const x2 = pos.x + vp.x, y2 = pos.y + vp.y;

    pushOp({ type: annotationTool, x1, y1, x2, y2, color: annotationColor, width: annotationWidth });
  };

  canvas.addEventListener('click', (e) => {
    if (!state.baseImage) return;
    if (annotationTool === 'eyedropper') sampleColorAt(e);
    else if (annotationTool === 'text') beginTextInputAt(e);
  });

  canvas.addEventListener('dblclick', (e) => {
    if (!state.baseImage || annotationTool !== 'select') return;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const vp = getViewportRect(state);
    const origX = (e.clientX - rect.left) * scale + vp.x;
    const origY = (e.clientY - rect.top) * scale + vp.y;
    const hit = hitTestAllOps(origX, origY);
    if (hit && hit.type === 'text') beginTextEditFor(hit);
  });
}

function sampleColorAt(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);
  const ctx = canvas.getContext('2d');
  let data;
  try {
    data = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y)), 1, 1).data;
  } catch (err) {
    showToast('Could not sample that pixel');
    return;
  }
  const hex = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  annotationColor = hex;
  document.getElementById('annotation-color').value = hex;
  setActiveTool(toolBeforeEyedropper || 'arrow');
}

function beginTextInputAt(e) {
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = canvasWrap.getBoundingClientRect();
  const scale = getCanvasDisplayScale(canvas);
  const vp = getViewportRect(state);
  const origX = (e.clientX - canvasRect.left) * scale + vp.x;
  const origY = (e.clientY - canvasRect.top) * scale + vp.y;

  const input = document.createElement('textarea');
  input.className = 'editor-text-input';
  input.rows = 1;
  input.style.left = `${e.clientX - wrapRect.left}px`;
  input.style.top = `${e.clientY - wrapRect.top - 11}px`;
  input.style.color = annotationColor;
  canvasWrap.appendChild(input);
  input.focus();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const text = input.value;
    input.remove();
    if (text && text.trim()) {
      pushOp({ type: 'text', x: origX, y: origY, text, color: annotationColor, size: 16 });
    }
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    input.remove();
  };

  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { cancel(); }
  });
  input.addEventListener('blur', commit);
}

function beginTextEditFor(op) {
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = canvasWrap.getBoundingClientRect();
  const scale = getCanvasDisplayScale(canvas);
  const vp = getViewportRect(state);
  const cssX = (op.x - vp.x) / scale + (canvasRect.left - wrapRect.left);
  const cssY = (op.y - vp.y) / scale + (canvasRect.top - wrapRect.top) - 11;

  const before = clone(op);
  const input = document.createElement('textarea');
  input.className = 'editor-text-input';
  input.rows = 1;
  input.value = op.text;
  input.style.left = `${cssX}px`;
  input.style.top = `${cssY}px`;
  input.style.color = op.color;
  canvasWrap.appendChild(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const text = input.value;
    input.remove();
    if (!text || !text.trim()) { deleteOp(op.id); return; }
    op.text = text;
    recordModify(op.id, before, clone(op));
    redraw();
  };
  const cancel = () => { if (committed) return; committed = true; input.remove(); };

  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { cancel(); }
  });
  input.addEventListener('blur', commit);
}

// toolbar wiring
function setupToolbar() {
  document.querySelectorAll('#tool-toggle .tag').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'eyedropper' && annotationTool !== 'eyedropper') {
        toolBeforeEyedropper = annotationTool;
      }
      setActiveTool(btn.dataset.tool);
    });
  });

  document.getElementById('annotation-color').addEventListener('input', (e) => {
    annotationColor = e.target.value;
  });

  document.querySelectorAll('#stroke-width-toggle .tag').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#stroke-width-toggle .tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      annotationWidth = parseInt(btn.dataset.width, 10) || 4;
    });
  });

  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);

  const cropApplyBtn = document.getElementById('crop-apply-btn');
  const cropCancelBtn = document.getElementById('crop-cancel-btn');
  if (cropApplyBtn) cropApplyBtn.addEventListener('click', commitPendingCrop);
  if (cropCancelBtn) cropCancelBtn.addEventListener('click', cancelPendingCrop);

  document.getElementById('copy-btn').addEventListener('click', async () => {
    if (!state.baseImage) return;
    try {
      await copyCanvasToClipboard(canvas);
      showToast('Screenshot copied to clipboard');
    } catch (e) {
      showToast('Could not copy screenshot');
    }
  });

  document.getElementById('download-btn').addEventListener('click', () => {
    if (!state.baseImage) return;
    const format = document.getElementById('download-format').value;
    const base = filenameBase || `screenshot-${Date.now()}`;
    if (format === 'pdf') showToast('Building PDF…');
    exportCanvas(canvas, format, domIntervals, dpr).then(blob => {
      downloadBlob(blob, `${base}.${format}`);
      showToast('Screenshot downloaded');
    }).catch(() => showToast(format === 'pdf' ? 'Could not build PDF' : 'Could not export image'));
  });
}

const TOOL_SHORTCUTS = { v: 'select', a: 'arrow', l: 'line', r: 'rect', e: 'ellipse', p: 'pen', h: 'highlight', t: 'text', b: 'blur', c: 'crop', i: 'eyedropper' };

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'z') { e.preventDefault(); undo(); return; }
      if (key === 'y') { e.preventDefault(); redo(); return; }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedOpId) {
      e.preventDefault();
      deleteOp(selectedOpId);
      return;
    }
    if (annotationTool === 'crop' && pendingCrop) {
      if (e.key === 'Enter') { e.preventDefault(); commitPendingCrop(); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelPendingCrop(); return; }
    }
    if (e.altKey) return;
    const tool = TOOL_SHORTCUTS[e.key.toLowerCase()];
    if (tool) setActiveTool(tool);
  });
}

applyStoredTheme();
setupToolbar();
setupCanvasInteractions();
setupKeyboardShortcuts();
loadHandoff();
