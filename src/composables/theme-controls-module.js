export function initThemeControls(deps) {
    var themeStore = deps.themeStore;
    var themeToggleBtn = deps.themeToggleBtn;
    var themeCustomBgInput = deps.themeCustomBgInput;
    var themeCustomTextInput = deps.themeCustomTextInput;
    var themeCustomSubInput = deps.themeCustomSubInput;
    var themeCustomBorderInput = deps.themeCustomBorderInput;
    var themeCustomButtonInput = deps.themeCustomButtonInput;
    var themeCustomResetBtn = deps.themeCustomResetBtn;

    themeStore.init();

    themeToggleBtn.addEventListener('click', function () {
        if (themeToggleBtn.getAttribute('aria-expanded') === 'true') {
            themeStore.closeCustomThemePanel();
        } else {
            themeStore.openCustomThemePanel();
        }
    });

    ['light', 'dark', 'custom'].forEach(function (mode) {
        var button = document.getElementById('theme-mode-' + mode);
        if (!button) return;
        button.addEventListener('click', function () {
            themeStore.applyThemeMode(mode);
            themeStore.openCustomThemePanel();
        });
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
        });
    });

    if (themeCustomResetBtn) {
        themeCustomResetBtn.addEventListener('click', function () {
            themeStore.applyCustomTheme(themeStore.CUSTOM_THEME_DEFAULTS);
        });
    }
}
