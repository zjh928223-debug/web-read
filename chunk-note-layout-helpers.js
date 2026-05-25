(function attachChunkNoteLayoutHelpers(global) {
  function getChunkNoteWrapTokens(text) {
    const t = String(text || '');
    if (!t) return [];
    if (/\s/.test(t)) return t.split(/(\s+)/).filter(Boolean);
    return Array.from(t);
  }

  function splitTokenToFitWidth(ctx, token, maxWidth) {
    if (!token) return [''];
    if (ctx.measureText(token).width <= maxWidth) return [token];
    const parts = [];
    let buf = '';
    for (const ch of Array.from(token)) {
      const candidate = buf + ch;
      if (buf && ctx.measureText(candidate).width > maxWidth) {
        parts.push(buf);
        buf = ch;
      } else {
        buf = candidate;
      }
    }
    if (buf) parts.push(buf);
    return parts.length ? parts : [token];
  }

  function wrapChunkNoteTextForCanvas(ctx, text, maxWidth) {
    const tokens = getChunkNoteWrapTokens(text);
    if (!tokens.length) return [''];
    const lines = [];
    let line = '';
    tokens.forEach((tkRaw) => {
      const tkParts = splitTokenToFitWidth(ctx, tkRaw, maxWidth);
      tkParts.forEach((tk) => {
        const candidate = line + tk;
        if (!line || ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
        } else {
          lines.push(line);
          line = tk.trimStart();
        }
      });
    });
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function truncateCanvasLine(ctx, text, maxWidth) {
    const src = String(text || '');
    if (!src) return '';
    if (ctx.measureText(src).width <= maxWidth) return src;
    const ellipsis = '...';
    let lo = 0;
    let hi = src.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = src.slice(0, mid) + ellipsis;
      if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return src.slice(0, Math.max(0, lo)) + ellipsis;
  }

  global.ChunkNoteLayoutHelpers = {
    getChunkNoteWrapTokens,
    splitTokenToFitWidth,
    wrapChunkNoteTextForCanvas,
    truncateCanvasLine
  };
})(window);
