// main.js

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { startAutomation, stopAutomation } = require('./automation');

let win;
let automationRunning = false;

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'assets', 'dtulogo.png'),
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('start-automation', async (event, data) => {
  if (automationRunning) {
    return { success: false, error: 'Automation is already running.' };
  }

  const { creds, courses, autoLogin } = data;
  const ipAddress = '14.139.251.105';
  automationRunning = true;

  try {
    startAutomation(creds, ipAddress, courses, autoLogin, {
      onStatusUpdate: (message) => win.webContents.send('status-update', message),
      onCourseRegistered: (course) => win.webContents.send('course-registered', course),
      onCourseBlocked: (course) => win.webContents.send('course-blocked', course),
      onError: (error) => win.webContents.send('automation-error', error),
      onStop: () => {
        automationRunning = false;
        win.webContents.send('status-update', 'Automation stopped.');
      },
    });
    return { success: true };
  } catch (error) {
    automationRunning = false;
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-automation', async () => {
  if (automationRunning) {
    stopAutomation();
    automationRunning = false;
  }
  return { success: true };
});
