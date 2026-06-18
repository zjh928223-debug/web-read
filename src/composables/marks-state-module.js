export function initMarksState(initialMarkedMap = null) {
    var markedMap = new Map();

    function setMarkedMap(nextMarkedMap) {
        markedMap.clear();
        if (nextMarkedMap instanceof Map) {
            nextMarkedMap.forEach(function (value, key) {
                markedMap.set(key, value);
            });
        }
        return markedMap;
    }

    if (initialMarkedMap) setMarkedMap(initialMarkedMap);

    return {
        get markedMap() { return markedMap; },
        setMarkedMap: setMarkedMap
    };
}
