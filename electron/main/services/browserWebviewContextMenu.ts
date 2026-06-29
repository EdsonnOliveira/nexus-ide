import {
  clipboard,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';

export function attachBrowserWebviewContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Voltar',
        enabled: contents.canGoBack(),
        click: () => contents.goBack(),
      },
      {
        label: 'Avançar',
        enabled: contents.canGoForward(),
        click: () => contents.goForward(),
      },
      {
        label: 'Recarregar',
        click: () => contents.reload(),
      },
      { type: 'separator' },
    ];

    if (params.linkURL) {
      template.push(
        {
          label: 'Abrir link',
          click: () => {
            void contents.loadURL(params.linkURL);
          },
        },
        {
          label: 'Abrir link no navegador externo',
          click: () => {
            void shell.openExternal(params.linkURL);
          },
        },
        {
          label: 'Copiar endereço do link',
          click: () => {
            clipboard.writeText(params.linkURL);
          },
        },
        { type: 'separator' },
      );
    }

    if (params.srcURL && params.mediaType === 'image') {
      template.push(
        {
          label: 'Copiar endereço da imagem',
          click: () => {
            clipboard.writeText(params.srcURL);
          },
        },
        { type: 'separator' },
      );
    }

    if (params.isEditable) {
      template.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
        { type: 'separator' },
      );
    } else if (params.selectionText.trim()) {
      template.push(
        { role: 'copy', enabled: params.editFlags.canCopy },
        { type: 'separator' },
      );
    }

    template.push({
      label: 'Inspecionar elemento',
      click: () => {
        contents.inspectElement(params.x, params.y);
      },
    });

    const menu = Menu.buildFromTemplate(template);
    menu.popup();
  });
}
