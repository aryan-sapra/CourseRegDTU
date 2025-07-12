// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startAutomation: (data) => ipcRenderer.invoke('start-automation', data),
  stopAutomation: () => ipcRenderer.invoke('stop-automation'),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', callback),
  onCourseRegistered: (callback) => ipcRenderer.on('course-registered', callback),
  onCourseBlocked: (callback) => ipcRenderer.on('course-blocked', callback),
  onError: (callback) => ipcRenderer.on('automation-error', callback),
});
