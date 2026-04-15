const el = {
  notionToken: document.getElementById('notionToken'),
  pageId: document.getElementById('pageId'),
  allowedHosts: document.getElementById('allowedHosts'),
  saveSettings: document.getElementById('saveSettings'),
  scanPage: document.getElementById('scanPage'),
  uploadCurrent: document.getElementById('uploadCurrent'),
  uploadManual: document.getElementById('uploadManual'),
  clearState: document.getElementById('clearState'),
  status: document.getElementById('status')
};

function setStatus(message) {
  el.status.textContent = message;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sanitizePageId(pageId) {
  return (pageId || '').replace(/[^a-fA-F0-9]/g, '');
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(['notionToken', 'pageId', 'allowedHosts']);
  el.notionToken.value = data.notionToken || '';
  el.pageId.value = data.pageId || '';
  el.allowedHosts.value = (data.allowedHosts || []).join('\n');
  const state = await chrome.storage.local.get(['lastDetected']);
  if (state.lastDetected?.url) {
    setStatus(`検出済みPDF:\n${state.lastDetected.url}`);
  } else {
    setStatus('未検出。学内サイトの課題ページを開いて「このページを検出」を押してください。');
  }
}

async function saveSettings() {
  const notionToken = el.notionToken.value.trim();
  const pageId = sanitizePageId(el.pageId.value.trim());
  const allowedHosts = el.allowedHosts.value.split(/\n+/).map(v => v.trim()).filter(Boolean);
  await chrome.storage.sync.set({ notionToken, pageId, allowedHosts });
  setStatus('設定を保存しました。');
}

async function sendMessageToTab(type) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('アクティブタブが取得できませんでした。');
  return chrome.tabs.sendMessage(tab.id, { type });
}

async function upload(payload) {
  const settings = await chrome.storage.sync.get(['notionToken', 'pageId', 'allowedHosts']);
  if (!settings.notionToken || !settings.pageId) {
    throw new Error('Notion Token と Page ID を設定してください。');
  }
  const tab = await getActiveTab();
  const response = await chrome.runtime.sendMessage({
    type: 'FETCH_AND_UPLOAD',
    payload,
    settings,
    sourceTabUrl: tab?.url || ''
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'アップロードに失敗しました。');
  }
  return response;
}

el.saveSettings.addEventListener('click', async () => {
  try {
    await saveSettings();
  } catch (error) {
    setStatus(`保存失敗: ${error.message}`);
  }
});

el.scanPage.addEventListener('click', async () => {
  try {
    const result = await sendMessageToTab('SCAN_PDFS');
    if (!result?.ok) throw new Error(result?.error || '検出に失敗しました。');
    if (!result.items.length) {
      setStatus('このページではPDFリンクを見つけられませんでした。');
      return;
    }
    const first = result.items[0];
    await chrome.storage.local.set({ lastDetected: first, allDetected: result.items });
    setStatus(`検出件数: ${result.items.length}\n最初のPDF:\n${first.url}`);
  } catch (error) {
    setStatus(`検出失敗: ${error.message}`);
  }
});

el.uploadCurrent.addEventListener('click', async () => {
  try {
    const state = await chrome.storage.local.get(['lastDetected']);
    if (!state.lastDetected?.url) throw new Error('先にPDFを検出してください。');
    setStatus('PDF取得とNotion送信を開始します...');
    const result = await upload(state.lastDetected);
    setStatus(`完了:\n${result.message}`);
  } catch (error) {
    setStatus(`送信失敗: ${error.message}`);
  }
});

el.uploadManual.addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.url) throw new Error('現在タブのURLを取得できません。');
    setStatus('現在タブのURLをPDFとして取得します...');
    const result = await upload({ url: tab.url, title: tab.title || 'current-tab.pdf' });
    setStatus(`完了:\n${result.message}`);
  } catch (error) {
    setStatus(`送信失敗: ${error.message}`);
  }
});

el.clearState.addEventListener('click', async () => {
  await chrome.storage.local.remove(['lastDetected', 'allDetected']);
  setStatus('検出状態を消去しました。');
});

loadSettings();
