(function () {
  const vscode = acquireVsCodeApi();
  const executeBtn = document.getElementById('executeBtn');
  const previewBtn = document.getElementById('previewBtn');
  const clearBtn = document.getElementById('clearBtn');
  const input = document.getElementById('patchInput');
  const diag = document.getElementById('diagnostics');
  const prevFileBtn = document.getElementById('prevFileBtn');
  const nextFileBtn = document.getElementById('nextFileBtn');
  const executeCurrentBtn = document.getElementById('executeCurrentBtn');
  const executeAllBtn = document.getElementById('executeAllBtn');
  const previewAllBtn = document.getElementById('previewAllBtn');
  const previewFileInfo = document.getElementById('previewFileInfo');
  const previewNav = document.getElementById('previewNav');

  executeBtn.addEventListener('click', () => {
    diag.innerHTML = '';
    vscode.postMessage({
      command: 'applyPatch',
      text: input.value,
    });
  });

  previewBtn.addEventListener('click', () => {
    diag.innerHTML = '';
    vscode.postMessage({
      command: 'previewPatch',
      text: input.value,
    });
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    diag.innerHTML = '';
    input.style.height = '300px';
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });

  prevFileBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'previewPrevFile' });
  });

  nextFileBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'previewNextFile' });
  });

  executeCurrentBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'executeCurrentFile' });
  });

  executeAllBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'executeAllFiles' });
  });

  previewAllBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'previewAllFiles' });
  });

  window.addEventListener('message', event => {
    const message = event.data;

    if (message.command === 'updatePreviewHeader') {
      const fileName = message.fileName || '';
      const fileIndex = message.fileIndex;
      const totalFiles = message.totalFiles;
      if (fileIndex === -1) {
        previewFileInfo.textContent = `All Files (${totalFiles} total)`;
      } else {
        previewFileInfo.textContent = `File ${fileIndex + 1} of ${totalFiles}: ${fileName}`;
      }
      previewNav.style.display = 'block';
      return;
    }

    if (message.command === 'showPreviewNavigation') {
      previewNav.style.display = 'block';
      return;
    }

    if (message.command === 'hidePreviewNavigation') {
      previewNav.style.display = 'none';
      previewFileInfo.textContent = '';
      return;
    }

    const div = document.createElement('div');
    div.className = message.command;
    div.textContent = message.message;
    diag.appendChild(div);

    });
})();
