export function initChunkNoteTransfer(deps = {}) {
    var importButton = deps.importButton;
    var importInput = deps.importInput;
    var exportButton = deps.exportButton;
    var getFirstFileFromEvent = deps.getFirstFileFromEvent;
    var readFileAsText = deps.readFileAsText;
    var applyImportedChunkNotes = deps.applyImportedChunkNotes;
    var saveChunkNotesNow = deps.saveChunkNotesNow;
    var getHasAiChunkData = deps.getHasAiChunkData;
    var getIsChunkMode = deps.getIsChunkMode;
    var enterChunkMode = deps.enterChunkMode;
    var setChunkNoteVisible = deps.setChunkNoteVisible;
    var renderChunkMode = deps.renderChunkMode;
    var buildChunkNotesSnapshot = deps.buildChunkNotesSnapshot;
    var getCurrentAudioFilenameBase = deps.getCurrentAudioFilenameBase;
    var getChunkNotesFileState = deps.getChunkNotesFileState;
    var setChunkNotesFileState = deps.setChunkNotesFileState;
    var getCurrentAudioKey = deps.getCurrentAudioKey;
    var showToast = deps.showToast;
    var showError = deps.showError;
    var exportDialogEl = null;
    var exportDialogKeydownHandler = null;

    function closeExportDialog() {
        if (exportDialogKeydownHandler) {
            document.removeEventListener('keydown', exportDialogKeydownHandler, true);
            exportDialogKeydownHandler = null;
        }
        if (exportDialogEl) {
            exportDialogEl.remove();
            exportDialogEl = null;
        }
    }

    function getExportDialogEl() {
        return exportDialogEl;
    }

    function supportsDirectOverwrite() {
        return typeof window.showSaveFilePicker === 'function';
    }

    function triggerDownload(snapshot, filename) {
        var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function writeToHandle(handle, snapshot) {
        var writable = await handle.createWritable();
        await writable.write(JSON.stringify(snapshot, null, 2));
        await writable.close();
    }

    async function saveAs(snapshot, suggestedName) {
        if (!supportsDirectOverwrite()) {
            triggerDownload(snapshot, suggestedName);
            setChunkNotesFileState({ handle: null, audioKey: '', fileName: suggestedName });
            return;
        }
        var handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
        });
        await writeToHandle(handle, snapshot);
        setChunkNotesFileState({
            handle,
            audioKey: getCurrentAudioKey() || 'default-audio',
            fileName: handle.name || suggestedName
        });
    }

    function openExportConfirmDialog(fileName, onSaveAs, onOverwrite) {
        closeExportDialog();
        var dialog = document.createElement('div');
        dialog.className = 'chunk-note-delete-dialog';
        dialog.innerHTML = `
          <div class="chunk-note-delete-title">检测到已保存文件，是否覆盖？</div>
          <div class="chunk-note-export-hint">${fileName || 'chunk_notes.json'}</div>
          <div class="chunk-note-delete-actions">
            <button type="button" class="chunk-note-delete-btn">另存为</button>
            <button type="button" class="chunk-note-delete-btn primary">确认覆盖</button>
          </div>
        `;
        document.body.appendChild(dialog);
        exportDialogEl = dialog;

        var left = Math.max(12, Math.min(window.innerWidth - 280, (window.innerWidth - 280) / 2));
        var top = Math.max(12, Math.min(window.innerHeight - 140, (window.innerHeight - 140) / 2));
        dialog.style.left = left + 'px';
        dialog.style.top = top + 'px';

        var buttons = dialog.querySelectorAll('.chunk-note-delete-btn');
        var saveAsButton = buttons[0];
        var overwriteButton = buttons[1];
        if (saveAsButton) {
            saveAsButton.addEventListener('click', async function () {
                closeExportDialog();
                await onSaveAs();
            });
        }
        if (overwriteButton) {
            overwriteButton.addEventListener('click', async function () {
                closeExportDialog();
                await onOverwrite();
            });
            overwriteButton.focus();
        }

        exportDialogKeydownHandler = function (event) {
            if (!exportDialogEl) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                if (overwriteButton) overwriteButton.click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closeExportDialog();
            }
        };
        document.addEventListener('keydown', exportDialogKeydownHandler, true);
    }

    if (importButton && importInput) {
        importButton.addEventListener('click', function () {
            importInput.click();
        });
        importInput.addEventListener('change', function (event) {
            var file = getFirstFileFromEvent(event);
            if (!file) return;
            readFileAsText(file, function (rawText) {
                try {
                    var data = JSON.parse(rawText);
                    applyImportedChunkNotes(data);
                    saveChunkNotesNow();
                    if (getHasAiChunkData()) {
                        if (!getIsChunkMode()) enterChunkMode();
                        setChunkNoteVisible(true, true);
                        renderChunkMode();
                    }
                    showToast('Chunk notes imported', 'success');
                } catch (error) {
                    showError('CHUNK_NOTE_IMPORT', error && error.message ? error.message : 'Invalid notes json');
                }
            });
            event.target.value = '';
        });
    }

    if (exportButton) {
        exportButton.addEventListener('click', async function () {
            var snapshot = buildChunkNotesSnapshot();
            var filenameBase = getCurrentAudioFilenameBase('audio');
            var suggestedName = filenameBase + '_chunk_notes.json';
            var fileState = getChunkNotesFileState();
            var sameAudioHandle = !!fileState.handle && (fileState.audioKey === (getCurrentAudioKey() || 'default-audio'));
            try {
                if (!sameAudioHandle) {
                    await saveAs(snapshot, suggestedName);
                    showToast('Chunk notes saved', 'success');
                    return;
                }
                openExportConfirmDialog(
                    fileState.fileName || suggestedName,
                    async function () {
                        await saveAs(snapshot, suggestedName);
                        showToast('Chunk notes saved as new file', 'success');
                    },
                    async function () {
                        var currentFileState = getChunkNotesFileState();
                        if (!currentFileState.handle) {
                            await saveAs(snapshot, suggestedName);
                        } else {
                            await writeToHandle(currentFileState.handle, snapshot);
                        }
                        showToast('Chunk notes overwritten', 'success');
                    }
                );
            } catch (error) {
                if (error && error.name === 'AbortError') return;
                showError('CHUNK_NOTE_EXPORT', error && error.message ? error.message : 'Export failed');
            }
        });
    }

    return {
        closeExportDialog,
        getExportDialogEl,
        writeToHandle,
        saveAs
    };
}
