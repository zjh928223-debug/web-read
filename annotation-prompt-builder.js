(function (global) {
    'use strict';

    const PROMPT_TEMPLATE = [
        '你是英语阅读器里的注释生成助手。',
        '你会收到一个 article block，以及 block 内若干已标记 target。',
        '每个 target 都带有它所在的完整句子，必须基于完整句子理解这个 target 在当前语境中的真实边界。',
        '不要机械扩边：有些 target 最终仍然只是单词；有些应扩成固定搭配；有些应扩成更自然的短语边界。',
        '最终输出必须是紧凑 annotation JSON，不要输出额外解释。',
        '',
        '输出要求：',
        '1. 只输出一个 JSON 对象，格式为 {"items":[...]}。',
        '2. items 里的每一项必须包含：targetId, markedText, boundary, type, meaning, memoryHint。',
        '3. targetId 必须原样回传，不能改写。',
        '4. boundary 必须是基于完整句子判断后的最终边界，允许等于 markedText，也允许扩成搭配或短语。',
        '5. meaning 以中文口语解释为主，通常 1 到 2 句，优先解释当前句中的实际意思，不要写成长段词典释义。',
        '6. memoryHint 用 1 句中文加英文提示，优先帮助中文学习者记住整块表达或常见搭配，不要展开冗长词源分析。',
        '7. type 使用现有兼容类型，例如 word / phrase / collocation / phrasal-verb / expression；若拿不准，可选最接近的兼容类型。',
        '8. 不要输出 sentence 字段，不要把完整句子塞进最终结果。',
        '9. 如果某个 target 在当前句中仍应保持单词本身，就让 boundary 等于 markedText。',
        '10. 返回内容必须适合直接显示给中文英语学习者阅读。'
    ].join('\n');

    function buildPromptPayload(block, options = {}) {
        const normalizedBlock = block && typeof block === 'object' ? block : {};
        const blockId = String(normalizedBlock.id || options.blockId || 'block-0');
        const targets = Array.isArray(normalizedBlock.targets)
            ? normalizedBlock.targets
                .map((target, index) => normalizeTarget(target, index, blockId))
                .filter(Boolean)
            : [];

        if (!targets.length) {
            return {
                skipped: true,
                reason: 'no-targets',
                blockId,
                prompt: '',
                targets: [],
                targetCount: 0,
                text: normalizeText(normalizedBlock.text || ''),
                contextText: normalizeText(normalizedBlock.contextText || normalizedBlock.text || '')
            };
        }

        const contextText = normalizeText(normalizedBlock.contextText || normalizedBlock.text || '');
        const annotationContext = buildAnnotationContextPayload(normalizedBlock, targets, options);
        const lines = [
            PROMPT_TEMPLATE,
            '',
            `BLOCK_ID=${blockId}`,
            '',
            'BLOCK_TEXT:',
            contextText,
            '',
            'TARGETS:'
        ];

        targets.forEach((target) => {
            lines.push(`- targetId=${target.id}`);
            lines.push(`  markedText=${target.markedText}`);
            lines.push(`  boundaryHint=${target.boundaryHint || target.markedText}`);
            lines.push(`  sourceType=${target.sourceType}`);
            lines.push(`  occurrenceKey=${target.occurrenceKey}`);
            lines.push(`  occurrenceRange=${formatOccurrenceRange(target)}`);
            lines.push(`  TARGET_SENTENCE=${normalizeText(target.sentenceText || target.sentencePlainText || '')}`);
        });

        if (annotationContext) {
            lines.push('');
            lines.push('ANNOTATION_CONTEXT_JSON:');
            lines.push(JSON.stringify(annotationContext, null, 2));
        }

        lines.push('');
        lines.push('再次提醒：只输出 JSON，不要输出 Markdown，不要用代码块包裹。');

        return {
            skipped: false,
            reason: '',
            blockId,
            prompt: lines.join('\n'),
            targets,
            annotationContext,
            targetCount: targets.length,
            text: normalizeText(normalizedBlock.text || ''),
            contextText
        };
    }

    function normalizeTarget(target, index, blockId) {
        if (!target || typeof target !== 'object') return null;

        const markedText = normalizeText(target.markedText || target.text || '');
        const boundaryHint = normalizeText(target.boundaryHint || target.boundary || markedText);
        const sentenceText = normalizeText(target.sentenceText || target.sentencePlainText || '');
        const occurrenceKey = normalizeText(
            target.occurrenceKey
            || target.occurrenceId
            || target.hitKey
            || ''
        );

        if (!markedText || !sentenceText || !occurrenceKey) return null;

        return {
            id: String(target.id || `${blockId}-target-${index}`),
            blockId,
            markedText,
            boundaryHint,
            sourceType: normalizeText(target.sourceType || target.source || 'unknown'),
            sentenceIndex: toInteger(target.sentenceIndex, -1),
            blockTargetIndex: toInteger(target.blockTargetIndex, index),
            sentenceText,
            sentencePlainText: normalizeText(target.sentencePlainText || sentenceText),
            occurrenceKey,
            occurrenceGlobalStart: toInteger(target.occurrenceGlobalStart, null),
            occurrenceGlobalEnd: toInteger(target.occurrenceGlobalEnd, null)
        };
    }

    function formatOccurrenceRange(target) {
        const start = toInteger(target.occurrenceGlobalStart, null);
        const end = toInteger(target.occurrenceGlobalEnd, null);
        if (start == null || end == null) return 'unknown';
        return `${start}-${end}`;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function buildAnnotationContextPayload(block, targets, options = {}) {
        const exporter = global.AnnotationContextExport;
        if (!exporter || typeof exporter.buildPayloadFromArticle !== 'function') return null;
        const articleText = normalizeText(block && (block.contextText || block.text || ''));
        if (!articleText) return null;
        const articleId = [
            normalizeText(options.documentId || ''),
            normalizeText(block && block.id)
        ].filter(Boolean).join('::');
        try {
            return exporter.buildPayloadFromArticle(articleText, targets.map((target) => ({
                id: target.id,
                targetId: target.id,
                markedText: target.markedText,
                sentenceText: target.sentenceText,
                sentencePlainText: target.sentencePlainText,
                occurrenceIndex: target.blockTargetIndex
            })), articleId);
        } catch (error) {
            return null;
        }
    }

    function toInteger(value, fallback) {
        const next = Number(value);
        return Number.isInteger(next) ? next : fallback;
    }

    function getPromptTemplate() {
        return PROMPT_TEMPLATE;
    }

    global.AnnotationPromptBuilder = {
        buildPromptPayload,
        getPromptTemplate
    };
})(window);
