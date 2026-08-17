export const ClipboardIpc = {
  WriteText: 'clipboard:writeText',
  ReadText: 'clipboard:readText',
  WriteImageFromFile: 'clipboard:writeImageFromFile',
  WriteImageFromDataUrl: 'clipboard:writeImageFromDataUrl',
} as const;

export type ClipboardIpc = typeof ClipboardIpc[keyof typeof ClipboardIpc];
