// screenshot shared helpers
(function (global) {

  function loadImageAsync(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // canvas scale
  function getCanvasDisplayScale(canvas) {
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? canvas.width / rect.width : 1;
  }

  // crop viewport
  function getViewportRect(state) {
    for (let i = state.ops.length - 1; i >= 0; i--) {
      if (state.ops[i].type === 'crop') return state.ops[i];
    }
    return { x: 0, y: 0, w: state.baseImage.width, h: state.baseImage.height };
  }

  function drawArrowAnnotation(ctx, op, scale) {
    const { x1, y1, x2, y2, color } = op;
    const width = (op.width || 4) * scale;
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(12, width * 4);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function drawLineAnnotation(ctx, op, scale) {
    const { x1, y1, x2, y2, color } = op;
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.lineWidth = (op.width || 4) * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawHighlightAnnotation(ctx, op, scale) {
    const { x1, y1, x2, y2, color } = op;
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.lineWidth = (op.width ? op.width * 0.75 : 3) * scale;
    ctx.strokeRect(x, y, w, h);
  }

  function drawRectAnnotation(ctx, op, scale) {
    const { x1, y1, x2, y2, color } = op;
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.lineWidth = (op.width || 4) * scale;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawEllipseAnnotation(ctx, op, scale) {
    const { x1, y1, x2, y2, color } = op;
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.lineWidth = (op.width || 4) * scale;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPenAnnotation(ctx, op, scale) {
    const points = op.points;
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = op.color;
    ctx.lineWidth = (op.width || 4) * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function drawTextAnnotation(ctx, op, scale) {
    const fontPx = Math.max(10, (op.size || 16) * scale);
    ctx.save();
    ctx.font = `600 ${fontPx}px Jost, -apple-system, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = op.color;
    (op.text || '').split('\n').forEach((line, i) => {
      ctx.fillText(line, op.x, op.y + i * fontPx * 1.25);
    });
    ctx.restore();
  }

  // marquee preview
  function drawMarqueeSelectionPreview(ctx, op, scale) {
    const x = Math.min(op.x1, op.x2), y = Math.min(op.y1, op.y2);
    const w = Math.abs(op.x2 - op.x1), h = Math.abs(op.y2 - op.y1);
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = '#000000';
    ctx.setLineDash([8 * scale, 6 * scale]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function applyBlurAnnotation(ctx, op) {
    const x = Math.min(op.x1, op.x2), y = Math.min(op.y1, op.y2);
    const w = Math.abs(op.x2 - op.x1), h = Math.abs(op.y2 - op.y1);
    if (w < 2 || h < 2) return;
    const blockSize = Math.max(6, Math.round(Math.min(w, h) / 12));
    const smallW = Math.max(1, Math.floor(w / blockSize));
    const smallH = Math.max(1, Math.floor(h / blockSize));

    const t = ctx.getTransform();
    const srcX = x * t.a + y * t.c + t.e;
    const srcY = x * t.b + y * t.d + t.f;

    const tmp = document.createElement('canvas');
    tmp.width = smallW;
    tmp.height = smallH;
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.drawImage(ctx.canvas, srcX, srcY, w, h, 0, 0, smallW, smallH);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, smallW, smallH, x, y, w, h);
    ctx.restore();
  }

  // canvas redraw
  function redrawCanvas(canvas, state, precomputedScale, selectedOp) {
    if (!state || !state.baseImage) return;
    const vp = getViewportRect(state);
    if (canvas.width !== vp.w) canvas.width = vp.w;
    if (canvas.height !== vp.h) canvas.height = vp.h;
    const ctx = canvas.getContext('2d');
    const scale = precomputedScale || getCanvasDisplayScale(canvas);
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(-vp.x, -vp.y);
    ctx.drawImage(state.baseImage, 0, 0);

    state.ops.forEach(op => { if (op.type === 'blur') applyBlurAnnotation(ctx, op); });
    state.ops.forEach(op => {
      if (op.type === 'arrow') drawArrowAnnotation(ctx, op, scale);
      else if (op.type === 'line') drawLineAnnotation(ctx, op, scale);
      else if (op.type === 'highlight') drawHighlightAnnotation(ctx, op, scale);
      else if (op.type === 'rect') drawRectAnnotation(ctx, op, scale);
      else if (op.type === 'ellipse') drawEllipseAnnotation(ctx, op, scale);
      else if (op.type === 'pen') drawPenAnnotation(ctx, op, scale);
      else if (op.type === 'text') drawTextAnnotation(ctx, op, scale);
    });
    if (selectedOp) drawSelectionOverlay(ctx, selectedOp, scale);
    ctx.restore();
  }

  // selection hit testing
  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lengthSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function getOpBounds(ctx, op) {
    if (op.type === 'pen') {
      const xs = op.points.map(p => p.x), ys = op.points.map(p => p.y);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    if (op.type === 'text') {
      const fontPx = op.size || 16;
      ctx.save();
      ctx.font = `600 ${fontPx}px Jost, -apple-system, sans-serif`;
      const lines = (op.text || '').split('\n');
      const width = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
      ctx.restore();
      return { x1: op.x, y1: op.y, x2: op.x + width, y2: op.y + lines.length * fontPx * 1.25 };
    }
    return {
      x1: Math.min(op.x1, op.x2), y1: Math.min(op.y1, op.y2),
      x2: Math.max(op.x1, op.x2), y2: Math.max(op.y1, op.y2)
    };
  }

  function isNearRectOutline(b, x, y, tolerance) {
    const withinX = x >= b.x1 - tolerance && x <= b.x2 + tolerance;
    const withinY = y >= b.y1 - tolerance && y <= b.y2 + tolerance;
    if (!withinX || !withinY) return false;
    return Math.abs(x - b.x1) <= tolerance || Math.abs(x - b.x2) <= tolerance ||
      Math.abs(y - b.y1) <= tolerance || Math.abs(y - b.y2) <= tolerance;
  }

  function hitTestOp(ctx, op, x, y, tolerance) {
    switch (op.type) {
      case 'highlight':
      case 'blur':
      case 'crop':
      case 'text': {
        const b = getOpBounds(ctx, op);
        return x >= b.x1 - tolerance && x <= b.x2 + tolerance && y >= b.y1 - tolerance && y <= b.y2 + tolerance;
      }
      case 'rect':
        return isNearRectOutline(getOpBounds(ctx, op), x, y, tolerance);
      case 'ellipse': {
        const b = getOpBounds(ctx, op);
        const rx = (b.x2 - b.x1) / 2, ry = (b.y2 - b.y1) / 2;
        if (rx <= 0 || ry <= 0) return false;
        const cx = b.x1 + rx, cy = b.y1 + ry;
        const norm = Math.sqrt(Math.pow((x - cx) / rx, 2) + Math.pow((y - cy) / ry, 2));
        return Math.abs(norm - 1) <= tolerance / Math.min(rx, ry);
      }
      case 'arrow':
      case 'line':
        return distanceToSegment(x, y, op.x1, op.y1, op.x2, op.y2) <= tolerance;
      case 'pen':
        for (let i = 1; i < op.points.length; i++) {
          if (distanceToSegment(x, y, op.points[i - 1].x, op.points[i - 1].y, op.points[i].x, op.points[i].y) <= tolerance) return true;
        }
        return false;
      default:
        return false;
    }
  }

  function getOpHandles(ctx, op) {
    if (op.type === 'text') return [];
    if (op.type === 'pen') {
      const b = getOpBounds(ctx, op);
      return [{ id: 'min', x: b.x1, y: b.y1 }, { id: 'max', x: b.x2, y: b.y2 }];
    }
    return [{ id: 'p1', x: op.x1, y: op.y1 }, { id: 'p2', x: op.x2, y: op.y2 }];
  }

  function drawSelectionOverlay(ctx, op, scale) {
    const b = getOpBounds(ctx, op);
    const pad = 4 * scale;
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([5 * scale, 4 * scale]);
    ctx.strokeRect(b.x1 - pad, b.y1 - pad, (b.x2 - b.x1) + pad * 2, (b.y2 - b.y1) + pad * 2);
    ctx.restore();

    const r = 5 * scale;
    getOpHandles(ctx, op).forEach(h => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeStyle = '#2563eb';
      ctx.stroke();
      ctx.restore();
    });
  }

  function hitTestHandle(ctx, op, x, y, scale) {
    const grab = 10 * scale;
    const handles = getOpHandles(ctx, op);
    for (const h of handles) {
      if (Math.hypot(x - h.x, y - h.y) <= grab) return h.id;
    }
    return null;
  }

  // pending (uncommitted) crop rect — 8 drag handles (corners + edge midpoints), like a
  // regular photo crop tool: 4 corners resize both axes, 4 edge midpoints resize one axis
  function getCropHandlePoints(rect) {
    const b = getOpBounds(null, rect);
    const midX = (b.x1 + b.x2) / 2, midY = (b.y1 + b.y2) / 2;
    return [
      { id: 'tl', x: b.x1, y: b.y1 }, { id: 'tm', x: midX, y: b.y1 }, { id: 'tr', x: b.x2, y: b.y1 },
      { id: 'ml', x: b.x1, y: midY }, { id: 'mr', x: b.x2, y: midY },
      { id: 'bl', x: b.x1, y: b.y2 }, { id: 'bm', x: midX, y: b.y2 }, { id: 'br', x: b.x2, y: b.y2 }
    ];
  }

  function hitTestCropHandle(rect, x, y, scale) {
    const grab = 10 * scale;
    for (const h of getCropHandlePoints(rect)) {
      if (Math.hypot(x - h.x, y - h.y) <= grab) return h.id;
    }
    return null;
  }

  // dims everything outside the rect, draws a rule-of-thirds grid inside it, then the
  // border + 8 handles — the standard chrome of a crop tool, drawn before the crop is applied
  function drawPendingCropOverlay(ctx, vp, rect, scale) {
    const b = getOpBounds(null, rect);
    const w = b.x2 - b.x1, h = b.y2 - b.y1;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(vp.x, vp.y, vp.w, b.y1 - vp.y);
    ctx.fillRect(vp.x, b.y2, vp.w, (vp.y + vp.h) - b.y2);
    ctx.fillRect(vp.x, b.y1, b.x1 - vp.x, h);
    ctx.fillRect(b.x2, b.y1, (vp.x + vp.w) - b.x2, h);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1 * scale;
    ctx.setLineDash([]);
    for (let i = 1; i <= 2; i++) {
      const x = b.x1 + (w * i) / 3;
      ctx.beginPath(); ctx.moveTo(x, b.y1); ctx.lineTo(x, b.y2); ctx.stroke();
      const y = b.y1 + (h * i) / 3;
      ctx.beginPath(); ctx.moveTo(b.x1, y); ctx.lineTo(b.x2, y); ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(b.x1, b.y1, w, h);
    ctx.restore();

    ctx.save();
    const hs = 4 * scale;
    getCropHandlePoints(rect).forEach(pt => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5 * scale;
      ctx.fillRect(pt.x - hs, pt.y - hs, hs * 2, hs * 2);
      ctx.strokeRect(pt.x - hs, pt.y - hs, hs * 2, hs * 2);
    });
    ctx.restore();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename }, (downloadId) => {
      if (chrome.runtime.lastError) window.open(url, '_blank');
    });
  }

  async function copyCanvasToClipboard(canvas) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not export image');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  // pdf export
  const PDF_PAGE_WIDTH_PT = 595.28;
  const PDF_PAGE_HEIGHT_PT = 841.89;

  async function deflateBytes(uint8) {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(uint8);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    chunks.forEach(c => { result.set(c, pos); pos += c.length; });
    return result;
  }

  function getRgbBytesFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    let j = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      rgb[j++] = rgba[i];
      rgb[j++] = rgba[i + 1];
      rgb[j++] = rgba[i + 2];
    }
    return rgb;
  }

  function findNearestSafeBreak(targetY, intervals, maxShiftPx) {
    let hit = null;
    for (let i = 0; i < intervals.length; i++) {
      const [top, bottom] = intervals[i];
      if (top > targetY) break;
      if (targetY <= bottom) { hit = [top, bottom]; break; }
    }
    if (!hit) return targetY;

    const beforeCandidate = hit[0];
    const afterCandidate = hit[1];
    const beforeDist = targetY - beforeCandidate;
    const afterDist = afterCandidate - targetY;

    if (beforeDist <= maxShiftPx && beforeDist <= afterDist) return Math.max(0, beforeCandidate);
    if (afterDist <= maxShiftPx) return afterCandidate;
    if (beforeDist <= maxShiftPx) return Math.max(0, beforeCandidate);
    return targetY;
  }

  function computeAdjustedBreakpoints(totalHeight, pxPerPage, intervals) {
    const maxShiftPx = pxPerPage * 0.35;
    const breaks = [];
    let cursor = 0;
    let iterations = 0;
    while (cursor < totalHeight - 0.5 && iterations < 5000) {
      iterations++;
      const target = cursor + pxPerPage;
      if (target >= totalHeight - 0.5) {
        breaks.push(totalHeight);
        break;
      }
      let adjusted = intervals ? findNearestSafeBreak(target, intervals, maxShiftPx) : target;
      if (adjusted <= cursor + 1) adjusted = target;
      breaks.push(adjusted);
      cursor = adjusted;
    }
    return breaks;
  }

  async function sliceCanvasIntoA4Pages(canvas, domIntervals, dpr) {
    const scale = PDF_PAGE_WIDTH_PT / canvas.width;
    const pxPerPage = PDF_PAGE_HEIGHT_PT / scale;

    let breakpoints;
    if (domIntervals && domIntervals.length && dpr) {
      const intervalsDevicePx = domIntervals.map(([top, bottom]) => [top * dpr, bottom * dpr]);
      breakpoints = computeAdjustedBreakpoints(canvas.height, pxPerPage, intervalsDevicePx);
    } else {
      breakpoints = [];
      let y = 0;
      while (y < canvas.height) {
        y = Math.min(y + pxPerPage, canvas.height);
        breakpoints.push(y);
      }
    }

    const pages = [];
    let prevY = 0;
    for (const breakY of breakpoints) {
      const srcY = Math.round(prevY);
      const bandHeightPx = Math.round(breakY) - srcY;
      prevY = breakY;
      if (bandHeightPx <= 0) continue;

      const bandCanvas = document.createElement('canvas');
      bandCanvas.width = canvas.width;
      bandCanvas.height = bandHeightPx;
      bandCanvas.getContext('2d').drawImage(
        canvas, 0, srcY, canvas.width, bandHeightPx,
        0, 0, canvas.width, bandHeightPx
      );

      const rgbBytes = getRgbBytesFromCanvas(bandCanvas);
      const compressed = await deflateBytes(rgbBytes);
      pages.push({
        widthPx: bandCanvas.width,
        heightPx: bandCanvas.height,
        heightPt: bandHeightPx * scale,
        bytes: compressed
      });
    }
    return pages;
  }

  function buildMultiPageA4Pdf(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const objOffsets = {};

    const push = (strOrBytes) => {
      const bytes = typeof strOrBytes === 'string' ? enc.encode(strOrBytes) : strOrBytes;
      chunks.push(bytes);
      offset += bytes.length;
    };
    const setOffset = (num) => { objOffsets[num] = offset; };

    push('%PDF-1.4\n');

    const pageObjNums = pages.map((_, i) => 3 + i * 3);

    setOffset(1);
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    setOffset(2);
    const kids = pageObjNums.map(n => `${n} 0 R`).join(' ');
    push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

    pages.forEach((page, i) => {
      const pageNum = pageObjNums[i];
      const imageNum = pageNum + 1;
      const contentNum = pageNum + 2;
      const topY = PDF_PAGE_HEIGHT_PT - page.heightPt;

      setOffset(pageNum);
      push(`${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /MediaBox [0 0 ${PDF_PAGE_WIDTH_PT} ${PDF_PAGE_HEIGHT_PT}] /Contents ${contentNum} 0 R >>\nendobj\n`);

      setOffset(imageNum);
      push(`${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${page.bytes.length} >>\nstream\n`);
      push(page.bytes);
      push('\nendstream\nendobj\n');

      const content = `q ${PDF_PAGE_WIDTH_PT} 0 0 ${page.heightPt} 0 ${topY} cm /Im0 Do Q`;
      setOffset(contentNum);
      push(`${contentNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    });

    const totalObjects = 2 + pages.length * 3;
    const xrefOffset = offset;
    let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= totalObjects; n++) {
      xref += `${String(objOffsets[n]).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    chunks.forEach(c => { result.set(c, pos); pos += c.length; });
    return result;
  }

  async function exportCanvas(canvas, format, domIntervals, dpr) {
    if (format === 'pdf') {
      const pages = await sliceCanvasIntoA4Pages(canvas, domIntervals, dpr);
      const pdfBytes = buildMultiPageA4Pdf(pages);
      return new Blob([pdfBytes], { type: 'application/pdf' });
    }
    const isJpg = format === 'jpg';
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('Could not export image'));
        else resolve(blob);
      }, isJpg ? 'image/jpeg' : 'image/png', isJpg ? 0.92 : undefined);
    });
  }

  global.ScreenshotShared = {
    HANDOFF_STORAGE_KEY: 'screenshot_handoff',
    loadImageAsync,
    getCanvasDisplayScale,
    getViewportRect,
    drawArrowAnnotation,
    drawLineAnnotation,
    drawHighlightAnnotation,
    drawRectAnnotation,
    drawEllipseAnnotation,
    drawPenAnnotation,
    drawTextAnnotation,
    drawMarqueeSelectionPreview,
    applyBlurAnnotation,
    redrawCanvas,
    getOpBounds,
    hitTestOp,
    getOpHandles,
    hitTestHandle,
    drawSelectionOverlay,
    drawPendingCropOverlay,
    hitTestCropHandle,
    downloadBlob,
    copyCanvasToClipboard,
    exportCanvas
  };

})(window);
