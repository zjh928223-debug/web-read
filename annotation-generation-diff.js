(function (global) {
    'use strict';

    const TargetSource = global.AnnotationTargetSource;

    function diffContextAgainstBundle(context = {}, generatedBundle = null) {
        const targetSource = TargetSource && typeof TargetSource.buildTargetSource === 'function'
            ? TargetSource.buildTargetSource(context)
            : { targets: [], bySentenceKey: new Map() };
        const currentTargets = Array.isArray(targetSource.targets) ? targetSource.targets : [];
        const generatedItems = normalizeGeneratedItems(generatedBundle && Array.isArray(generatedBundle.items) ? generatedBundle.items : []);
        const generatedKeySet = new Set(generatedItems.map((item) => item.occurrenceKey).filter(Boolean));

        const missingTargets = currentTargets.filter((target) => !generatedKeySet.has(normalizeText(target && target.occurrenceKey)));
        const missingTargetKeys = missingTargets
            .map((target) => normalizeText(target && target.occurrenceKey))
            .filter(Boolean);
        const generatedTargetsCount = currentTargets.reduce((count, target) => (
            generatedKeySet.has(normalizeText(target && target.occurrenceKey)) ? count + 1 : count
        ), 0);

        return {
            targetSource,
            currentTargets,
            generatedItems,
            generatedKeySet,
            allTargetsCount: currentTargets.length,
            generatedTargetsCount,
            missingTargets,
            missingTargetKeys
        };
    }

    function normalizeGeneratedItems(items) {
        return items
            .map((item) => ({
                occurrenceKey: normalizeText(item && item.occurrenceKey)
            }))
            .filter((item) => item.occurrenceKey);
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    global.AnnotationGenerationDiff = {
        diffContextAgainstBundle
    };
})(window);
