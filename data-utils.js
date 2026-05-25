(function attachDataUtils(global) {
  function isPlainObjectRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function normalizeLooseKey(key) {
    return String(key || '').replace(/\uFEFF/g, '').trim().toLowerCase();
  }

  function getLooseProp(obj, names) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const targets = new Set((names || []).map(normalizeLooseKey));
    const keys = Object.keys(obj);
    for (const k of keys) {
      if (targets.has(normalizeLooseKey(k))) return obj[k];
    }
    return undefined;
  }

  function looksLikeSegmentArray(arr) {
    if (!Array.isArray(arr)) return false;
    if (arr.length === 0) return true;
    const first = arr[0];
    if (!first || typeof first !== 'object') return false;
    return (
      Array.isArray(first.words) ||
      typeof first.text === 'string' ||
      first.start !== undefined ||
      first.end !== undefined ||
      first.word !== undefined
    );
  }

  function validateTranscriptData(json, segmentsFallback) {
    if (typeof json === 'string') {
      try { json = JSON.parse(json); } catch (e) {}
    }
    for (let depth = 0; depth < 4; depth++) {
      if (!json || typeof json !== 'object' || Array.isArray(json)) break;
      const wrapped = getLooseProp(json, ['content', 'data', 'payload', 'result']);
      if (wrapped === undefined) break;
      if (typeof wrapped === 'string') {
        try { json = JSON.parse(wrapped); } catch (e) { json = wrapped; }
      } else {
        json = wrapped;
      }
      if (typeof json === 'string') {
        try { json = JSON.parse(json); } catch (e) {}
      }
    }

    let segments = null;
    if (Array.isArray(json)) {
      segments = json;
    } else if (json && typeof json === 'object') {
      const segVal = getLooseProp(json, ['segments', 'segment']);
      if (Array.isArray(segVal)) {
        segments = segVal;
      } else if (segVal && typeof segVal === 'object' && !Array.isArray(segVal)) {
        const maybeArr = Object.values(segVal);
        if (looksLikeSegmentArray(maybeArr)) segments = maybeArr;
      }
      if (!segments) {
        const transcriptObj = getLooseProp(json, ['transcript']);
        if (transcriptObj && typeof transcriptObj === 'object') {
          const nestedSeg = getLooseProp(transcriptObj, ['segments', 'segment']);
          if (Array.isArray(nestedSeg)) segments = nestedSeg;
        }
      }
      if (!segments) {
        const items = getLooseProp(json, ['items']);
        if (Array.isArray(items)) segments = items;
      }
      if (!segments) {
        const words = getLooseProp(json, ['words']);
        if (Array.isArray(words)) segments = [{ words }];
      }
      if (!segments) {
        const arrayCandidate = Object.values(json).find(v => looksLikeSegmentArray(v));
        if (Array.isArray(arrayCandidate)) segments = arrayCandidate;
      }
    }
    if (!Array.isArray(segments)) {
      const typeName = Object.prototype.toString.call(json);
      const keys = (json && typeof json === 'object' && !Array.isArray(json))
        ? Object.keys(json).slice(0, 8).map(k => JSON.stringify(k)).join(',')
        : '';
      throw new Error(`transcript.segments must be an array (got ${typeName}${keys ? ` keys: ${keys}` : ''})`);
    }

    if (segments.length > 0) {
      const first = segments[0];
      const looksLikeWordArray =
        first && typeof first === 'object' &&
        !Array.isArray(first.words) &&
        (first.word !== undefined || first.text !== undefined);
      if (looksLikeWordArray) {
        segments = [{ words: segments }];
      }
    }

    segments.forEach((seg, sIdx) => {
      if (!seg || typeof seg !== 'object') {
        throw new Error(`segment[${sIdx}] is invalid`);
      }
      if (!Array.isArray(seg.words)) {
        if (typeof seg.text === 'string' && seg.text.trim()) {
          const start = isFiniteNum(seg.start) ? seg.start : 0;
          const end = isFiniteNum(seg.end) ? seg.end : start;
          seg.words = [{ word: seg.text, start, end }];
        } else {
          seg.words = [];
        }
      }
      seg.words.forEach((w, wIdx) => {
        const token = (w && (w.word || w.text || '')).toString().trim();
        if (!token) throw new Error(`segment[${sIdx}].words[${wIdx}] missing text`);
        if (!isFiniteNum(w.start)) {
          const altStart =
            isFiniteNum(Number(w.start_time)) ? Number(w.start_time) :
            isFiniteNum(Number(w.startTime)) ? Number(w.startTime) :
            (isFiniteNum(seg.start) ? seg.start : NaN);
          if (!isFiniteNum(altStart)) throw new Error(`segment[${sIdx}].words[${wIdx}] missing start`);
          w.start = altStart;
        }
        if (w.end !== undefined && !isFiniteNum(w.end)) throw new Error(`segment[${sIdx}].words[${wIdx}] end must be number`);
        if (w.end === undefined) {
          const altEnd =
            isFiniteNum(Number(w.end_time)) ? Number(w.end_time) :
            isFiniteNum(Number(w.endTime)) ? Number(w.endTime) :
            w.start;
          w.end = altEnd;
        }
        if (isFiniteNum(w.end) && w.end < w.start) throw new Error(`segment[${sIdx}].words[${wIdx}] end < start`);
      });
      if (!isFiniteNum(seg.start) && seg.words.length > 0) seg.start = seg.words[0].start;
      if (!isFiniteNum(seg.end) && seg.words.length > 0) seg.end = seg.words[seg.words.length - 1].end ?? seg.words[seg.words.length - 1].start;
      if (isFiniteNum(seg.start) && isFiniteNum(seg.end) && seg.end < seg.start) {
        throw new Error(`segment[${sIdx}] end < start`);
      }
    });
    return { ...(json && typeof json === 'object' ? json : {}), segments };
  }

  function validateVisualData(input) {
    const list = input && input.vocab_list ? input.vocab_list : (Array.isArray(input) ? input : null);
    if (!Array.isArray(list)) throw new Error('visual data must be array or { vocab_list }');
    const validCount = list.filter(v => v && typeof v.word === 'string' && v.word.trim()).length;
    if (validCount === 0) throw new Error('visual data has no valid vocab item');
    return input;
  }

  function validateChunkData(input) {
    const hasNewFmt = input && Array.isArray(input.s);
    const hasOldFmt = Array.isArray(input) || (input && Array.isArray(input.items));
    if (!hasNewFmt && !hasOldFmt) {
      throw new Error('chunk data must be new format {s:[...]} or old format array/items');
    }
    return input;
  }

  function validateMarksArray(input, maxWordLen) {
    if (!Array.isArray(input)) throw new Error('marks must be an array');
    input.forEach((m, i) => {
      if (!m || !Number.isInteger(m.globalIndex)) throw new Error(`marks[${i}] missing integer globalIndex`);
      if (m.globalIndex < 0 || m.globalIndex >= maxWordLen) throw new Error(`marks[${i}] globalIndex out of range`);
    });
    return input;
  }

  global.DataUtils = {
    isPlainObjectRecord,
    isFiniteNum,
    normalizeLooseKey,
    getLooseProp,
    looksLikeSegmentArray,
    validateTranscriptData,
    validateVisualData,
    validateChunkData,
    validateMarksArray
  };
})(window);
