import { BrowserWindow, Menu, type WebContents } from 'electron';
import { t } from './i18n';

/**
 * Hidden Edit menu so Ctrl/Cmd+C/V/X/A/Z keep working in text fields even
 * when the window chrome hides the menu bar.
 */
export function buildEditOnlyMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
  ]);
}

/** Apply a hidden Edit menu to a BrowserWindow (keeps keyboard clipboard shortcuts). */
export function installHiddenEditMenu(win: BrowserWindow): void {
  if (process.platform === 'darwin') {
    // macOS needs the application menu for Edit accelerators.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    );
    return;
  }
  win.setMenu(buildEditOnlyMenu());
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
}

/**
 * Right-click Cut / Copy / Paste / Select All on editable inputs and textareas.
 * Also offers Copy when the user selected non-editable text.
 */
export function installEditableContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    if (webContents.isDestroyed()) return;

    const { editFlags, isEditable, selectionText } = params;
    const hasSelection = Boolean(selectionText?.trim());
    const items: Electron.MenuItemConstructorOptions[] = [];

    if (isEditable) {
      items.push(
        {
          label: t('editUndo'),
          role: 'undo',
          enabled: editFlags.canUndo,
        },
        {
          label: t('editRedo'),
          role: 'redo',
          enabled: editFlags.canRedo,
        },
        { type: 'separator' },
        {
          label: t('editCut'),
          role: 'cut',
          enabled: editFlags.canCut,
        },
        {
          label: t('editCopy'),
          role: 'copy',
          enabled: editFlags.canCopy,
        },
        {
          label: t('editPaste'),
          role: 'paste',
          enabled: editFlags.canPaste,
        },
        {
          label: t('editDelete'),
          role: 'delete',
          enabled: editFlags.canDelete,
        },
        { type: 'separator' },
        {
          label: t('editSelectAll'),
          role: 'selectAll',
          enabled: editFlags.canSelectAll,
        },
      );
    } else if (hasSelection && editFlags.canCopy) {
      items.push({
        label: t('editCopy'),
        role: 'copy',
      });
    }

    if (items.length === 0) return;

    const menu = Menu.buildFromTemplate(items);
    const win = BrowserWindow.fromWebContents(webContents) ?? undefined;
    menu.popup({
      window: win,
      x: Math.round(params.x),
      y: Math.round(params.y),
    });
  });
}
