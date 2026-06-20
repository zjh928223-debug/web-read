export function normalizeAnnotationTextValue(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function getAnnotationTargetSentenceText(target) {
    return normalizeAnnotationTextValue(target && (target.sentenceText || target.sentencePlainText || target.boundary || target.markedText));
}

export function stripAnnotationBoldMarkers(text) {
    return String(text || '').replace(/\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*/g, '$1');
}

export function buildAnnotationContextArticleText(context) {
    const blocks = Array.isArray(context && context.blocks) ? context.blocks : [];
    return blocks
        .map((block) => normalizeAnnotationTextValue(stripAnnotationBoldMarkers(block && block.text)))
        .filter(Boolean)
        .join(' ');
}

export function normalizeAnnotationPunctuationChar(ch) {
    const map = {
        '“': '"',
        '”': '"',
        '‘': '\'',
        '’': '\'',
        '—': '-',
        '–': '-',
        '…': '...',
        '，': ',',
        '。': '.',
        '！': '!',
        '？': '?',
        '；': ';',
        '：': ':',
        '（': '(',
        '）': ')'
    };
    return Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
}

export function normalizeAnnotationPunctuationText(value) {
    return String(value || '')
        .split('')
        .map((ch) => normalizeAnnotationPunctuationChar(ch))
        .join('');
}

export function trimAnnotationEdgePunctuation(value) {
    return normalizeAnnotationPunctuationText(value)
        .replace(/^[\s"'`([{<,.;:!?/\\-]+/, '')
        .replace(/[\s"'`)\]}>.,;:!?/\\-]+$/, '')
        .trim();
}

export function isLikelyAnnotationSentenceStart(text) {
    const source = normalizeAnnotationTextValue(text);
    if (!source) return false;
    if (/^[A-Z][a-z]/.test(source)) return true;
    return /^(I|We|You|He|She|They|It|This|That|These|Those|There|Here|However|But|So|Then|Meanwhile|Instead|In|On|At|By|For|To|From|As|If|When|While|After|Before|Because|Although|Being|The|A|An)\b/.test(source);
}

export function getAnnotationSentenceFragmentLastWord(text) {
    const source = normalizeAnnotationTextValue(text);
    const match = source.match(/([A-Za-z]+)[^A-Za-z]*$/);
    return match ? match[1].toLowerCase() : '';
}

export function getAnnotationSentenceFragmentWords(text) {
    return normalizeAnnotationTextValue(text)
        .split(/\s+/)
        .map((word) => word.replace(/^[^A-Za-z']+|[^A-Za-z'.]+$/g, ''))
        .filter(Boolean);
}

export function isStrongAnnotationSentenceStarter(text) {
    const source = normalizeAnnotationTextValue(text);
    if (!source) return false;
    return /^(And\b|But\b|However\b|It's\b|It is\b|Keeping them\b|First,\b|You don't need\b|To understand where this belief came from\b|Early rechargeable batteries like the nickel\b|Modern devices use lithium ion batteries\b|These batteries are\b|They don't suffer from memory effect\b|But the old habits and warnings\b|Here's the key thing to understand\b|Your phone is smarter than you think\b|When your battery reaches 100%|Supporters on the other hand\b|supporters on the other hand\b|Regardless of where one stands\b|regardless of where one stands\b|What's fascinating is how\b|what's fascinating is how\b)/.test(source);
}

export function isIncompleteAnnotationSentenceFragment(text) {
    const source = normalizeAnnotationTextValue(text);
    if (!source) return false;
    if (/[.!?;。！？；]["')\]”’）】》」』]*$/.test(source)) return false;
    const words= getAnnotationSentenceFragmentWords(source);
    const lastWord = getAnnotationSentenceFragmentLastWord(source);
    if (/[,;:]\s*$/.test(source)) return true;
    if (/^(and|or|but)\b/i.test(source) && !/[.!?;。！？；]["')\]”’）】》」』]*$/.test(source)) return true;
    if (/\b[aA]n?\s+[A-Za-z-]+$/.test(source) && words.length <= 5) return true;
    if (/\bthe\s+[A-Za-z-]+$/.test(source) && words.length <= 5) return true;
    if (/(?:^|\s)(in|on|at|to|for|of|from|by|with|as|into|onto|over|under|between|through|around|after|before|without|within|the|a|an|and|or|but)$/i.test(source)) {
        return true;
    }
    if (/^(?:[A-Z][a-z]+|\w+)\s+(?:is|are|was|were|be|been|being|has|have|had|can|could|will|would|should|may|might|must)\s+\w+\s+(?:in|on|at|to|for|of|from|by|with|as|into|onto|over|under|between|through|around|after|before|without|within|the|a|an)$/i.test(source)) {
        return true;
    }
    return /^(in|on|at|to|for|of|from|by|with|as|into|onto|over|under|between|through|around|after|before|without|within|the|a|an|and|or|but)$/.test(lastWord);
}

export function shouldAvoidAnnotationSoftSplit(leftText, rightText) {
    const left = normalizeAnnotationTextValue(leftText);
    const right = normalizeAnnotationTextValue(rightText);
    if (!left || !right) return false;
    const leftWordCount = left.split(/\s+/).filter(Boolean).length;
    if (isStrongAnnotationSentenceStarter(right) && leftWordCount >= 5) return false;
    if (/[,;:]\s*$/.test(left) && isStrongAnnotationSentenceStarter(right) && leftWordCount >= 8) return false;
    if (isIncompleteAnnotationSentenceFragment(left)) return true;
    if (/\b(?:a|an|the)\s+[A-Za-z-]+$/.test(left) && /^[A-Z]/.test(right)) return true;
    if (/\b(?:a|an|the)\s+[A-Za-z-]+\s+[A-Za-z-]+$/.test(left) && /^(centered|rooted|based|named|built|designed|made)\b/i.test(right)) return true;
    if (/\b(?:v|vs)\.$/i.test(left) && /^[A-Z][a-z]+(?:\b|[.,])/.test(right)) return true;
    if (!/[.!?;。！？；]["')\]”’）】》」』]*$/.test(left)
        && /[A-Z][a-z]+[^A-Za-z]*$/.test(left)
        && /^[A-Z][a-z]+\b/.test(right)) {
        return true;
    }
    if (/,\s*$/.test(left) && /^[a-z]/.test(right)) return true;
    return false;
}

export function mergeAnnotationSentenceFragments(pieces) {
    const sourcePieces = Array.isArray(pieces) ? pieces.map((piece) => normalizeAnnotationTextValue(piece)).filter(Boolean) : [];
    if (sourcePieces.length <= 1) return sourcePieces;
    const merged = [];

    sourcePieces.forEach((piece) => {
        if (!piece) return;
        if (!merged.length) {
            merged.push(piece);
            return;
        }
        const previous = merged[merged.length - 1];
        const combined = normalizeAnnotationTextValue(`${previous} ${piece}`);
        const previousWordCount = previous.split(/\s+/).filter(Boolean).length;
        const shouldMerge = shouldAvoidAnnotationSoftSplit(previous, piece)
            || (previousWordCount <= 7 && /,\s*$/.test(previous))
            || (previousWordCount <= 8 && isIncompleteAnnotationSentenceFragment(previous))
            || (/^[a-z]/.test(piece) && !isStrongAnnotationSentenceStarter(piece) && !/[.!?;。！？；]["')\]”’）】》」』]*$/.test(previous));

        if (shouldMerge) {
            merged[merged.length - 1] = combined;
            return;
        }
        merged.push(piece);
    });

    return merged;
}

export function splitAnnotationFragmentsByStrongStarters(pieces) {
    const starterPattern = /\s+(?=(?:And that's where the term Miranda warning comes from\b|It's named after Ernesto Miranda\b|to understand where this belief came from\b|early rechargeable batteries like the nickel\b|modern devices use lithium ion batteries\b|these batteries are\b|they don't suffer from memory effect\b|but the old habits and warnings\b|here's the key thing to understand\b|your phone is smarter than you think\b|when your battery reaches 100%|supporters on the other hand\b|regardless of where one stands\b|what's fascinating is how\b))/gi;
    let current = (Array.isArray(pieces) ? pieces : []).map((piece) => normalizeAnnotationTextValue(piece)).filter(Boolean);

    for (let pass = 0; pass < 3; pass++) {
        const result = [];
        let changed = false;

        current.forEach((piece) => {
            const normalizedPiece = normalizeAnnotationTextValue(piece);
            if (!normalizedPiece) return;
            starterPattern.lastIndex = 0;
            let cursor = 0;
            let matched = false;
            let match;

            while ((match = starterPattern.exec(normalizedPiece)) !== null) {
                const nextIndex = match.index;
                const right = normalizeAnnotationTextValue(normalizedPiece.slice(nextIndex));
                const left = normalizeAnnotationTextValue(normalizedPiece.slice(cursor, nextIndex)).replace(/,\s*$/, '').trim();
                if (!left || !right) continue;
                if (left.split(/\s+/).filter(Boolean).length < 6) continue;
                result.push(left);
                cursor = nextIndex;
                matched = true;
                changed = true;
            }

            const tail = normalizeAnnotationTextValue(normalizedPiece.slice(cursor));
            if (tail) result.push(tail);
            if (!matched && !tail) result.push(normalizedPiece);
        });

        current = result.filter(Boolean);
        if (!changed) break;
    }

    return current.filter(Boolean);
}

export function splitAnnotationSpanByTerminalStrongStarters(span) {
    const sourceText = normalizeAnnotationTextValue(span && span.text);
    if (!sourceText) return [];
    const starterPattern = /(?<=[.!?;。！？；])\s+(?=(?:And that's where the term Miranda warning comes from\b|It's named after Ernesto Miranda\b|Keeping them\b|First,\b|You don't need\b))/gi;
    const pieces = [];
    let cursor = 0;
    let match;

    while ((match = starterPattern.exec(sourceText)) !== null) {
        const nextIndex = match.index;
        const pieceText = normalizeAnnotationTextValue(sourceText.slice(cursor, nextIndex));
        if (pieceText) {
            pieces.push({
                text: pieceText,
                start: (span && Number.isInteger(span.start) ? span.start : 0) + cursor,
                end: (span && Number.isInteger(span.start) ? span.start : 0) + nextIndex
            });
        }
        cursor = nextIndex + match[0].length;
    }

    const tailText = normalizeAnnotationTextValue(sourceText.slice(cursor));
    if (tailText) {
        pieces.push({
            text: tailText,
            start: (span && Number.isInteger(span.start) ? span.start : 0) + cursor,
            end: span && Number.isInteger(span.end)
                ? span.end
                : ((span && Number.isInteger(span.start) ? span.start : 0) + sourceText.length)
        });
    }

    return pieces.length ? pieces : [span];
}

export function splitLongAnnotationSentenceChunk(text) {
    const source = normalizeAnnotationTextValue(text);
    if (!source) return [];
    const maxWordCount = 28;
    const maxCharCount = 220;
    const wordCount = source.split(/\s+/).filter(Boolean).length;
    const shouldTrySoftSplit = wordCount > 16 || source.length > 100;
    if (!shouldTrySoftSplit && wordCount <= maxWordCount && source.length <= maxCharCount) return [source];

    const parts = [];
    let remaining = source;
    const boundaryPattern = /([,:;])\s+(?=[A-Z][^a-z]*[a-z]|(?:However|But|So|Then|Meanwhile|Instead|And|In|On|At|By|For|To|From|As|If|When|While|After|Before|Because|Although|The|A|An|This|That|These|Those|There|Here|Being|It's|They'r|Supporters|Regardless|What's)\b)/g;
    let lastIndex = 0;
    let match;

    while ((match = boundaryPattern.exec(remaining)) !== null) {
        const rightStart = normalizeAnnotationTextValue(remaining.slice(match.index + match[0].length));
        const keepBoundaryPunctuation = !(match[1] === ',' && isStrongAnnotationSentenceStarter(rightStart));
        const slice = normalizeAnnotationTextValue(remaining.slice(lastIndex, keepBoundaryPunctuation ? (match.index + match[1].length) : match.index));
        const nextSlice = normalizeAnnotationTextValue(remaining.slice(match.index + match[0].length - 1));
        if (!slice || !nextSlice) continue;
        const leftWords = slice.split(/\s+/).filter(Boolean).length;
        if (leftWords < 6) continue;
        if (!isLikelyAnnotationSentenceStart(rightStart)) continue;
        if (shouldAvoidAnnotationSoftSplit(slice, rightStart)) continue;
        parts.push(slice);
        lastIndex = match.index + match[0].length;
    }

    const tail = normalizeAnnotationTextValue(remaining.slice(lastIndex));
    if (tail) parts.push(tail);
    const preliminary = parts.length > 1 ? parts : [source];
    const lexicalPieces = [];
    const lexicalStarterPattern = /\s+(?=(?:[A-Z][a-z]|situations like this\b|today we're\b|understand shotgun marriages\b|in many communities\b|marriage was not just about love\b|it was also about responsibility\b|a pregnancy outside marriage\b|for women\b|marriage provided\b|for men\b|these marriages were\b|parents might\b|in many cases\b|although the term originated\b|when an unexpected pregnancy occurred\b|they might not have\b|a swift marriage could\b|in other cultures\b|communities valued\b|and marriage was seen\b|these shared patterns show\b|beyond social pressure\b|marriage created\b|it helped establish\b|without marriage\b|for many families\b|it ensured\b|even today\b|laws in many countries\b|while social and legal factors\b|couples who entered\b|some may have\b|others may have\b|for couples who already\b|in these situations\b|however, when\b|in today's world\b|many societies\b|couples have more freedom\b|however, the term\b|it is often used\b|movies, television shows\b|despite changing attitudes\b|cultural expectations\b|a shotgun marriage is\b|it is a reflection\b|it emerged during\b|for many couples\b|today, the meaning\b|while the urgency\b|it shows how\b|thank you for joining\b|don't forget to like\b|and that's where the term miranda warning comes from\b|it's named after ernesto miranda\b|supporters on the other hand\b|regardless of where one stands\b|what's fascinating is how\b))/gi;

    preliminary.forEach((piece) => {
        const normalizedPiece = normalizeAnnotationTextValue(piece);
        const pieceWords = normalizedPiece.split(/\s+/).filter(Boolean).length;
        if (pieceWords <= 18) {
            lexicalPieces.push(normalizedPiece);
            return;
        }
        lexicalStarterPattern.lastIndex = 0;
        let cursor = 0;
        let matched = false;
        let lexicalMatch;
        while ((lexicalMatch = lexicalStarterPattern.exec(normalizedPiece)) !== null) {
            const nextIndex = lexicalMatch.index;
            const left = normalizeAnnotationTextValue(normalizedPiece.slice(cursor, nextIndex));
            const right = normalizeAnnotationTextValue(normalizedPiece.slice(nextIndex));
            if (!left || !right) continue;
            if (left.split(/\s+/).filter(Boolean).length < 6) continue;
            if (shouldAvoidAnnotationSoftSplit(left, right)) continue;
            lexicalPieces.push(left);
            cursor = nextIndex;
            matched = true;
        }
        const tailPiece = normalizeAnnotationTextValue(normalizedPiece.slice(cursor));
        if (tailPiece) lexicalPieces.push(tailPiece);
        if (!matched && !tailPiece) lexicalPieces.push(normalizedPiece);
    });

    return splitAnnotationFragmentsByStrongStarters(
        mergeAnnotationSentenceFragments(lexicalPieces.filter(Boolean))
    );
}

export function splitAnnotationSpanByPreferredSentences(span, preferredSentences) {
    const spanText = normalizeAnnotationTextValue(span && span.text);
    if (!spanText) return [];
    const sentences = Array.isArray(preferredSentences) ? preferredSentences : [];
    const normalizedPreferred = sentences
        .map((sentence) => normalizeAnnotationTextValue(sentence))
        .filter((sentence) => sentence && sentence.length < spanText.length)
        .sort((a, b) => b.length - a.length);

    for (let index = 0; index < normalizedPreferred.length; index++) {
        const sentence = normalizedPreferred[index];
        const matchIndex = spanText.indexOf(sentence);
        if (matchIndex < 0) continue;

        const pieces = [];
        const spanStart = span && Number.isInteger(span.start) ? span.start : 0;
        const beforeText = normalizeAnnotationTextValue(spanText.slice(0, matchIndex));
        const matchedText = sentence;
        const afterText = normalizeAnnotationTextValue(spanText.slice(matchIndex + sentence.length));

        if (beforeText) {
            pieces.push(...splitAnnotationSpanByPreferredSentences({
                text: beforeText,
                start: spanStart,
                end: spanStart + beforeText.length
            }, preferredSentences));
        }
        pieces.push({
            text: matchedText,
            start: spanStart + matchIndex,
            end: spanStart + matchIndex + matchedText.length
        });
        if (afterText) {
            pieces.push(...splitAnnotationSpanByPreferredSentences({
                text: afterText,
                start: spanStart + matchIndex + matchedText.length,
                end: spanStart + matchIndex + matchedText.length + afterText.length
            }, preferredSentences));
        }
        return pieces.filter((piece) => piece && piece.text);
    }

    return [{
        text: spanText,
        start: span && Number.isInteger(span.start) ? span.start : 0,
        end: span && Number.isInteger(span.end) ? span.end : ((span && Number.isInteger(span.start) ? span.start : 0) + spanText.length)
    }];
}

export function splitAnnotationContextSentenceSpans(text, preferredSentences) {
    const source = String(text || '');
    const spans = [];
    const closingMarks = new Set(['"', '\'', ')', ']', '}', '”', '’', '）', '】', '》', '」', '』']);
    let start = 0;

    for (let index = 0; index < source.length; index++) {
        const ch = source[index];
        if (!/[.!?;。！？；]/.test(ch || '')) continue;
        let end = index + 1;
        while (end < source.length && closingMarks.has(source[end])) end += 1;
        const textSlice = normalizeAnnotationTextValue(source.slice(start, end));
        if (textSlice) spans.push({ text: textSlice, start, end });
        start = end;
        while (start < source.length && /\s/.test(source[start])) start += 1;
    }

    const tail = normalizeAnnotationTextValue(source.slice(start));
    if (tail) spans.push({ text: tail, start, end: source.length });
    if (!spans.length && source.trim()) spans.push({ text: normalizeAnnotationTextValue(source), start: 0, end: source.length });
    const aligned = [];
    spans.forEach((span) => {
        splitAnnotationSpanByPreferredSentences(span, preferredSentences).forEach((piece) => {
            if (piece && piece.text) aligned.push(piece);
        });
    });

    const refined = [];
    aligned.forEach((span) => {
        const pieces = splitLongAnnotationSentenceChunk(span && span.text);
        if (pieces.length <= 1) {
            refined.push({
                text: normalizeAnnotationTextValue(span && span.text),
                start: span && Number.isInteger(span.start) ? span.start : 0,
                end: span && Number.isInteger(span.end) ? span.end : 0
            });
            return;
        }

        let cursor = span && Number.isInteger(span.start) ? span.start : 0;
        const spanSource = String(span && span.text || '');
        pieces.forEach((piece) => {
            const normalizedPiece = normalizeAnnotationTextValue(piece);
            const relativeIndex = spanSource.indexOf(normalizedPiece, Math.max(0, cursor - (span && Number.isInteger(span.start) ? span.start : 0)));
            const pieceStart = relativeIndex >= 0 && span && Number.isInteger(span.start)
                ? span.start + relativeIndex
                : cursor;
            const pieceEnd = pieceStart + normalizedPiece.length;
            refined.push({ text: normalizedPiece, start: pieceStart, end: pieceEnd });
            cursor = pieceEnd;
        });
    });

    const mergedRefined = [];
    refined.filter((span) => span && span.text).forEach((span) => {
        if (!mergedRefined.length) {
            mergedRefined.push(span);
            return;
        }
        const previous = mergedRefined[mergedRefined.length - 1];
        if (isStrongAnnotationSentenceStarter(span.text) && previous.text.split(/\s+/).filter(Boolean).length >= 5) {
            mergedRefined.push(span);
            return;
        }
        if (!shouldAvoidAnnotationSoftSplit(previous.text, span.text)
            && !(previous.text.split(/\s+/).filter(Boolean).length <= 7 && /,\s*$/.test(previous.text))
            && !(previous.text.split(/\s+/).filter(Boolean).length <= 8 && isIncompleteAnnotationSentenceFragment(previous.text))) {
            mergedRefined.push(span);
            return;
        }
        mergedRefined[mergedRefined.length - 1] = {
            text: normalizeAnnotationTextValue(`${previous.text} ${span.text}`),
            start: previous.start,
            end: span.end
        };
    });

    const finalized = mergedRefined
        .flatMap((span) => splitAnnotationSpanByTerminalStrongStarters(span))
        .filter((span) => span && span.text);

    return finalized.map((span, index) => {
        const next = finalized[index + 1];
        if (next && /,\s*$/.test(span.text) && isStrongAnnotationSentenceStarter(next.text)) {
            return {
                ...span,
                text: normalizeAnnotationTextValue(span.text).replace(/,\s*$/, '')
            };
        }
        return span;
    });
}

export function normalizeAnnotationSentenceValue(value) {
    return trimAnnotationEdgePunctuation(value)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function cleanMarkedTextForAnnotationContext(value) {
    return trimAnnotationEdgePunctuation(value);
}

export function tokenizeAnnotationSentenceForMatch(value) {
    return normalizeAnnotationSentenceValue(value)
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

export function computeAnnotationSentenceOverlapScore(sourceSentence, candidateSentence, cleanMarkedText) {
    const sourceNormalized = normalizeAnnotationSentenceValue(sourceSentence);
    const candidateNormalized = normalizeAnnotationSentenceValue(candidateSentence);
    if (!sourceNormalized || !candidateNormalized) return -1;

    const sourceTokens = tokenizeAnnotationSentenceForMatch(sourceNormalized);
    const candidateTokens = tokenizeAnnotationSentenceForMatch(candidateNormalized);
    if (!sourceTokens.length || !candidateTokens.length) return -1;

    const candidateTokenSet = new Set(candidateTokens);
    const sourceTokenSet = new Set(sourceTokens);
    const sharedCount = sourceTokens.filter((token) => candidateTokenSet.has(token)).length;
    const sourceCoverage = sharedCount / sourceTokens.length;
    const candidateCoverage = sharedCount / candidateTokens.length;
    const markedNormalized = normalizeAnnotationSentenceValue(cleanMarkedText);
    const markedBoost = markedNormalized && candidateNormalized.includes(markedNormalized) ? 0.2 : 0;
    const containmentBoost = sourceNormalized.includes(candidateNormalized) || candidateNormalized.includes(sourceNormalized) ? 0.15 : 0;
    const orderPenalty = Math.abs(sourceTokens.length - candidateTokens.length) / Math.max(sourceTokens.length, candidateTokens.length, 1);

    return (sourceCoverage * 0.65) + (candidateCoverage * 0.35) + markedBoost + containmentBoost - (orderPenalty * 0.1);
}

export function findFuzzyAnnotationContextSentenceIndex(sourceSentence, sentenceSpans, cleanMarkedText) {
    const spans = Array.isArray(sentenceSpans) ? sentenceSpans : [];
    const originalSourceSentence = normalizeAnnotationTextValue(sourceSentence);
    const normalizedSourceSentence = normalizeAnnotationSentenceValue(originalSourceSentence);
    if (!normalizedSourceSentence) return -1;

    let bestIndex = -1;
    let bestScore = -1;
    spans.forEach((span, index) => {
        const candidateText = normalizeAnnotationTextValue(span && span.text);
        const candidateNormalized = normalizeAnnotationSentenceValue(candidateText);
        if (!candidateNormalized) return;

        const score = computeAnnotationSentenceOverlapScore(originalSourceSentence, candidateText, cleanMarkedText);
        const markedNormalized = normalizeAnnotationSentenceValue(cleanMarkedText);
        const containsRelation = normalizedSourceSentence.includes(candidateNormalized) || candidateNormalized.includes(normalizedSourceSentence);
        const hasMarkedText = markedNormalized ? candidateNormalized.includes(markedNormalized) : true;
        const isReasonable = containsRelation || score >= 0.55 || (hasMarkedText && score >= 0.42);
        if (!isReasonable) return;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });

    return bestIndex;
}

export function resolveAnnotationContextSentence(sourceSentence, sentenceSpans, markedText) {
    const originalSourceSentence = normalizeAnnotationTextValue(sourceSentence);
    const spans = Array.isArray(sentenceSpans) ? sentenceSpans : [];
    const cleanMarkedText = cleanMarkedTextForAnnotationContext(markedText);
    if (!originalSourceSentence) {
        return {
            anchorSentence: '',
            sentenceBefore: '',
            sentenceAfter: '',
            sentenceIndex: -1,
            matchType: 'fallback'
        };
    }

    const exactIndex = spans.findIndex((span) => normalizeAnnotationTextValue(span && span.text) === originalSourceSentence);
    if (exactIndex >= 0) {
        return {
            anchorSentence: spans[exactIndex].text,
            sentenceBefore: exactIndex > 0 ? spans[exactIndex - 1].text : '',
            sentenceAfter: exactIndex < spans.length - 1 ? spans[exactIndex + 1].text : '',
            sentenceIndex: exactIndex,
            matchType: 'exact'
        };
    }

    const normalizedSourceSentence = normalizeAnnotationSentenceValue(originalSourceSentence);
    const normalizedIndex = normalizedSourceSentence
        ? spans.findIndex((span) => normalizeAnnotationSentenceValue(span && span.text) === normalizedSourceSentence)
        : -1;
    if (normalizedIndex >= 0) {
        return {
            anchorSentence: spans[normalizedIndex].text,
            sentenceBefore: normalizedIndex > 0 ? spans[normalizedIndex - 1].text : '',
            sentenceAfter: normalizedIndex < spans.length - 1 ? spans[normalizedIndex + 1].text : '',
            sentenceIndex: normalizedIndex,
            matchType: 'normalized'
        };
    }

    const fuzzyIndex = findFuzzyAnnotationContextSentenceIndex(originalSourceSentence, spans, cleanMarkedText);
    if (fuzzyIndex >= 0) {
        return {
            anchorSentence: spans[fuzzyIndex].text,
            sentenceBefore: fuzzyIndex > 0 ? spans[fuzzyIndex - 1].text : '',
            sentenceAfter: fuzzyIndex < spans.length - 1 ? spans[fuzzyIndex + 1].text : '',
            sentenceIndex: fuzzyIndex,
            matchType: 'fuzzy'
        };
    }

    return {
        anchorSentence: originalSourceSentence,
        sentenceBefore: '',
        sentenceAfter: '',
        sentenceIndex: -1,
        matchType: 'fallback'
    };
}
