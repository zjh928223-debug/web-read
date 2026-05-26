export function findChunkIndexByTime(chunkItems, time) {
    if (!Array.isArray(chunkItems) || chunkItems.length === 0) return -1;
    let lo = 0;
    let hi = chunkItems.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (time >= chunkItems[mid].start) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

export function bsFindActive(wordStarts, words, time) {
    if (!Array.isArray(wordStarts) || wordStarts.length === 0) return -1;
    let lo = 0;
    let hi = wordStarts.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (wordStarts[mid] <= time) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return (ans !== -1 && time < ((words[ans] && words[ans].end) || ((words[ans] && words[ans].start) || 0) + 2.0)) ? ans : -1;
}

export function getCurrentSegmentIndex(segments, words, wordStarts, time) {
    if (!Array.isArray(segments) || segments.length === 0) return -1;
    const wordIdx = bsFindActive(wordStarts, words, time);
    if (wordIdx !== -1 && words[wordIdx]) return words[wordIdx].segIndex;
    let lo = 0;
    let hi = segments.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((segments[mid].start ?? 0) <= time) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (ans === -1) return time < (segments[0].start ?? 0) ? 0 : -1;
    const seg = segments[ans];
    const segEnd = seg.end ?? seg.start ?? 0;
    if (time <= segEnd) return ans;
    return ans < segments.length - 1 ? ans + 1 : ans;
}

export function getSegmentCheckpoints(segments, segIndex) {
    if (!Array.isArray(segments) || segIndex < 0 || segIndex >= segments.length) return [];
    const seg = segments[segIndex];
    const points = [seg.start];
    if (seg.words && seg.words.length > 0) {
        for (let i = 0; i < seg.words.length - 1; i++) {
            const w = seg.words[i];
            const txt = w.word || w.text || '';
            if (/[.!?\u3002\uff01\uff1f]/.test(txt)) points.push(seg.words[i + 1].start);
        }
    }
    return points;
}

window.PlaybackIndexHelpers = { findChunkIndexByTime, bsFindActive, getCurrentSegmentIndex, getSegmentCheckpoints };
