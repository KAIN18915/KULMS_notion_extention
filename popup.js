const el = {
  notionToken: document.getElementById('notionToken'),
  databaseId: document.getElementById('databaseId'),
  dataSourceSelect: document.getElementById('dataSourceSelect'),
  pageSelect: document.getElementById('pageSelect'),
  allowedHosts: document.getElementById('allowedHosts'),
  saveSettings: document.getElementById('saveSettings'),
  loadDatabasePages: document.getElementById('loadDatabasePages'),
  scanPage: document.getElementById('scanPage'),
  uploadCurrent: document.getElementById('uploadCurrent'),
  uploadManual: document.getElementById('uploadManual'),
  clearState: document.getElementById('clearState'),
  status: document.getElementById('status')
};

let cachedDatabaseData = { dataSources: [], pagesByDataSource: {} };

function setStatus(message) {
  el.status.textContent = message;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function extractNotion32Hex(input, kindLabel) {
  const value = (input || '').trim();
  if (!value) return '';

  const matches = value.match(/[a-fA-F0-9]{32}/g);
  if (matches?.length) return matches[matches.length - 1].toLowerCase();

  const compact = value.replace(/[^a-fA-F0-9]/g, '');
  if (compact.length === 32) return compact.toLowerCase();

  throw new Error(`${kindLabel} は32文字のIDかNotion URLを入力してください。`);
}

function renderDataSourceOptions(dataSources, selectedId = '') {
  el.dataSourceSelect.innerHTML = '';
  if (!dataSources.length) {
    el.dataSourceSelect.innerHTML = '<option value="">Data Source が見つかりません</option>';
    return;
  }

  for (const ds of dataSources) {
    const option = document.createElement('option');
    option.value = ds.id;
    option.textContent = ds.name || ds.id;
    if (ds.id === selectedId) option.selected = true;
    el.dataSourceSelect.appendChild(option);
  }
}

function renderPageOptions(pages, selectedId = '') {
  el.pageSelect.innerHTML = '';
  if (!pages.length) {
    el.pageSelect.innerHTML = '<option value="">ページが見つかりません</option>';
    return;
  }

  for (const page of pages) {
    const option = document.createElement('option');
    option.value = page.id;
    option.textContent = `${page.title || 'Untitled'} (${page.id})`;
    if (page.id === selectedId) option.selected = true;
    el.pageSelect.appendChild(option);
  }
}

async function loadSettings() {
  const data = await chrome.storage.sync.get([
    'notionToken',
    'databaseId',
    'dataSourceId',
    'targetPageId',
    'allowedHosts'
  ]);

  el.notionToken.value = data.notionToken || '';
  el.databaseId.value = data.databaseId || '';
  el.allowedHosts.value = (data.allowedHosts || []).join('\n');

  if (data.databaseId && data.notionToken) {
    try {
      await fetchDatabasePages({ silent: true });
      if (data.dataSourceId) {
        el.dataSourceSelect.value = data.dataSourceId;
        updatePageSelectFromCache(data.targetPageId || '');
      }
      if (data.targetPageId) {
        el.pageSelect.value = data.targetPageId;
      }
    } catch {
      // keep UI usable even if initial fetch fails
    }
  }

  const state = await chrome.storage.local.get(['lastDetected']);
  if (state.lastDetected?.url) {
    setStatus(`検出済みPDF:\n${state.lastDetected.url}`);
  } else {
    setStatus('未検出。学内サイトの課題ページを開いて「このページを検出」を押してください。');
  }
}

function updatePageSelectFromCache(selectedPageId = '') {
  const dataSourceId = el.dataSourceSelect.value;
  const pages = cachedDatabaseData.pagesByDataSource[dataSourceId] || [];
  renderPageOptions(pages, selectedPageId);
}

async function saveSettings() {
  const notionToken = el.notionToken.value.trim();
  const databaseId = extractNotion32Hex(el.databaseId.value, 'Database ID');
  const dataSourceId = el.dataSourceSelect.value || '';
  const targetPageId = el.pageSelect.value || '';
  const allowedHosts = el.allowedHosts.value.split(/\n+/).map(v => v.trim()).filter(Boolean);

  await chrome.storage.sync.set({
    notionToken,
    databaseId,
    dataSourceId,
    targetPageId,
    allowedHosts
  });

  el.databaseId.value = databaseId;
  setStatus('設定を保存しました。');
}

async function fetchDatabasePages({ silent = false } = {}) {
  const notionToken = el.notionToken.value.trim();
  const databaseId = extractNotion32Hex(el.databaseId.value, 'Database ID');

  if (!notionToken) throw new Error('Notion Token を入力してください。');
  if (!silent) setStatus('データベース内のページ一覧を取得しています...');

  const response = await chrome.runtime.sendMessage({
    type: 'LIST_DATABASE_PAGES',
    token: notionToken,
    databaseId
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'ページ一覧の取得に失敗しました。');
  }

  cachedDatabaseData = {
    dataSources: response.dataSources || [],
    pagesByDataSource: response.pagesByDataSource || {}
  };

  const selectedDataSourceId = response.selectedDataSourceId || response.dataSources?.[0]?.id || '';
  renderDataSourceOptions(cachedDatabaseData.dataSources, selectedDataSourceId);
  updatePageSelectFromCache();

  await chrome.storage.sync.set({
    databaseId,
    dataSourceId: el.dataSourceSelect.value || '',
    targetPageId: el.pageSelect.value || ''
  });

  const pageCount = Object.values(cachedDatabaseData.pagesByDataSource)
    .reduce((sum, arr) => sum + arr.length, 0);
  setStatus(`取得完了: Data Source ${cachedDatabaseData.dataSources.length}件 / ページ ${pageCount}件`);
}

async function sendMessageToTab(type) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('アクティブタブが取得できませんでした。');
  return chrome.tabs.sendMessage(tab.id, { type });
}

async function upload(payload) {
  const settings = await chrome.storage.sync.get([
    'notionToken',
    'databaseId',
    'dataSourceId',
    'targetPageId',
    'allowedHosts'
  ]);

  if (!settings.notionToken) throw new Error('Notion Token を設定してください。');
  if (!settings.targetPageId) throw new Error('埋め込み先ページを選択してください。');

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

el.loadDatabasePages.addEventListener('click', async () => {
  try {
    await fetchDatabasePages();
  } catch (error) {
    setStatus(`取得失敗: ${error.message}`);
  }
});

el.dataSourceSelect.addEventListener('change', async () => {
  updatePageSelectFromCache();
  await chrome.storage.sync.set({
    dataSourceId: el.dataSourceSelect.value || '',
    targetPageId: el.pageSelect.value || ''
  });
});

el.pageSelect.addEventListener('change', async () => {
  await chrome.storage.sync.set({ targetPageId: el.pageSelect.value || '' });
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
