const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    focusWindow: () => ipcRenderer.send('focus-window'),
    onShowMediaPicker: (callback) => ipcRenderer.on('show-media-picker', (event, sources) => callback(sources)),
    sendMediaPickerResult: (sourceId) => ipcRenderer.send('media-picker-result', sourceId),
    setAntiCheat: (enabled) => ipcRenderer.send('set-anti-cheat', enabled),
    forceQuit: () => ipcRenderer.send('force-quit'),
    onForceReportCheat: (callback) => ipcRenderer.on('force-report-cheat', (event, reason) => callback(reason))
});
