export function initThemeControls(deps) {
    var themeStore = deps.themeStore;
    var themeToggleBtn = deps.themeToggleBtn;
    var themeCustomBgInput = deps.themeCustomBgInput;
    var themeCustomTextInput = deps.themeCustomTextInput;
    var themeCustomSubInput = deps.themeCustomSubInput;
    var themeCustomBorderInput = deps.themeCustomBorderInput;
    var themeCustomButtonInput = deps.themeCustomButtonInput;
    var themeCustomResetBtn = deps.themeCustomResetBtn;
    var refreshAllChunkNoteVisuals = deps.refreshAllChunkNoteVisuals;
    var getLockChunkNoteDimensionsForTheme = deps.getLockChunkNoteDimensionsForTheme || function () {
        return window.__lockChunkNoteDimensionsForTheme;
    };

    themeStore.init();

    themeToggleBtn.addEventListener('click', function () {
        var lockChunkNoteDimensionsForTheme = getLockChunkNoteDimensionsForTheme();
        if (typeof lockChunkNoteDimensionsForTheme === 'function') {
            lockChunkNoteDimensionsForTheme();
        }
        var currentTheme = localStorage.getItem('theme') || 'light';
        var nextTheme = currentTheme === 'light' ? 'dark' : (currentTheme === 'dark' ? 'custom' : 'light');
        themeStore.applyThemeMode(nextTheme);
        if (nextTheme === 'custom') {
            themeStore.openCustomThemePanel();
        } else {
            themeStore.closeCustomThemePanel();
        }
        refreshAllChunkNoteVisuals();
    });

    [
        ['bg', themeCustomBgInput],
        ['text', themeCustomTextInput],
        ['sub', themeCustomSubInput],
        ['border', themeCustomBorderInput],
        ['button', themeCustomButtonInput]
    ].forEach(function (pair) {
        var key = pair[0];
        var input = pair[1];
        if (!input) return;
        input.addEventListener('input', function () {
            var colors = themeStore.getStoredCustomThemeColors();
            colors[key] = input.value;
            themeStore.applyCustomTheme(colors);
            refreshAllChunkNoteVisuals();
        });
        input.addEventListener('change', function () {
            themeStore.closeCustomThemePanel();
        });
    });

    if (themeCustomResetBtn) {
        themeCustomResetBtn.addEventListener('click', function () {
            themeStore.applyCustomTheme(themeStore.CUSTOM_THEME_DEFAULTS);
            themeStore.closeCustomThemePanel();
            refreshAllChunkNoteVisuals();
        });
    }
}
