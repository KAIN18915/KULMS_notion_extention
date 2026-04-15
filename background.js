const NOTION_VERSION = '2026-03-11';

function normalizeNotionId(input) {
  const raw = (input || '').trim();
  if (!raw) {
    throw new Error('Notion Page ID が空です。');
  }

  const directHex = raw.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  if (directHex.length === 32) {
    return [
      directHex.slice(0, 8),
      directHex.slice(8, 12),
      directHex.slice(12, 16),
      directHex.slice(16, 20),
      directHex.slice(20, 32)
    ].join('-');
  }

  const matches = raw.match(/[a-fA-F0-9]{32}/g);
  if (matches && matches.length > 0) {
    const hex = matches[matches.length - 1].toLowerCase();
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32)
    ].join('-');
  }

  throw new Error(`Notion Page ID が不正です。現在: ${raw}`);
}

function allowedHostCheck(url, allowedHosts = []) {
  if (!allowedHosts.length) return true;
  const host = new URL(url).hostname;
  return allowedHosts.some(
    allowed => host === allowed || host.endsWith(`.${allowed}`)
  );
}

function guessFilename(payload, response, fallbackUrl = null) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
  if (match?.[1]) {
    return decodeURIComponent(match[1].replace(/\"/g, ''));
  }

  const urlToUse = fallbackUrl || payload.url;
  const fromUrl = new URL(urlToUse).pathname.split('/').pop();
  if (fromUrl && fromUrl.includes('.')) {
    return fromUrl;
  }

  const title = payload.title || 'document';
  const safe = title.replace(/[^\w.-]+/g, '_');
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

async function fetchWithSession(url) {
  return fetch(url, {
    method: 'GET',
    credentials: 'include',
    redirect: 'follow'
  });
}

function extractPdfCandidatesFromHtml(html, baseUrl) {
  const candidates = new Set();

  const patterns = [
    /<iframe[^>]+src=["']([^"']+)["']/gi,
    /<embed[^>]+src=["']([^"']+)["']/gi,
    /<object[^>]+data=["']([^"']+)["']/gi,
    /<a[^>]+href=["']([^"']+)["']/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const abs = new URL(match[1], baseUrl).href;
        if (
          /\.pdf(\?|#|$)/i.test(abs) ||
          /pdf/i.test(abs) ||
          /content-type=application%2Fpdf/i.test(abs) ||
          /content-type=application\/pdf/i.test(abs)
        ) {
          candidates.add(abs);
        }
      } catch {
        // ignore malformed URL
      }
    }
  }

  return [...candidates];
}

async function fetchPdfAsBlob(url, depth = 0, visited = new Set()) {
  if (depth > 3) {
    throw new Error('PDF URLの追跡が深すぎます。中継ページが多すぎます。');
  }

  if (visited.has(url)) {
    throw new Error('PDF URL追跡中に循環参照を検出しました。');
  }
  visited.add(url);

  const response = await fetchWithSession(url);

  if (!response.ok) {
    throw new Error(`PDF取得失敗: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
    return {
      blob: await response.blob(),
      response,
      finalUrl: response.url || url
    };
  }

  if (contentType.includes('text/html')) {
    const html = await response.text();
    const candidates = extractPdfCandidatesFromHtml(html, response.url || url);

    if (!candidates.length) {
      throw new Error(
        `PDF以外の応答です。content-type=${contentType} HTML内からPDFリンクを見つけられませんでした。先頭: ${html.slice(0, 120)}`
      );
    }

    for (const candidate of candidates) {
      try {
        return await fetchPdfAsBlob(candidate, depth + 1, visited);
      } catch {
        // try next candidate
      }
    }

    throw new Error(
      `HTML内にPDF候補はありましたが取得できませんでした。候補数=${candidates.length}`
    );
  }

  throw new Error(`PDF以外の応答です。content-type=${contentType}`);
}

async function notionFetch(path, token, options = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Notion API error ${response.status}: ${json.message || text}`);
  }

  return json;
}

async function createFileUpload({ token }) {
  return notionFetch('/file_uploads', token, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

function extractFileUploadInfo(created) {
  const fileUploadId =
    created?.id ||
    created?.file_upload?.id;

  const uploadUrl =
    created?.upload_url ||
    created?.file_upload?.upload_url;

  if (!fileUploadId || !uploadUrl) {
    throw new Error('Notionのfile_upload作成応答から id / upload_url を取得できませんでした。');
  }

  return { fileUploadId, uploadUrl };
}

async function sendFileToNotion({ token, uploadUrl, blob, filename }) {
  const formData = new FormData();
  formData.append('file', blob, filename);

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION
    },
    body: formData
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Notion send error ${response.status}: ${json.message || text}`);
  }

  return json;
}

async function uploadFileToNotion({ token, filename, blob }) {
  const created = await createFileUpload({ token });
  const { fileUploadId, uploadUrl } = extractFileUploadInfo(created);

  await sendFileToNotion({
    token,
    uploadUrl,
    blob,
    filename
  });

  return fileUploadId;
}

async function appendPdfBlockToPage({
  token,
  pageId,
  fileUploadId,
  filename,
  sourceUrl
}) {
  const normalizedPageId = normalizeNotionId(pageId);

  const body = {
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: `Imported from university portal: ${filename}`
              }
            }
          ]
        }
      },
      {
        object: 'block',
        type: 'pdf',
        pdf: {
          type: 'file_upload',
          file_upload: {
            id: fileUploadId
          },
          caption: [
            {
              type: 'text',
              text: {
                content: sourceUrl.slice(0, 180)
              }
            }
          ]
        }
      }
    ]
  };

  return notionFetch(`/blocks/${normalizedPageId}/children`, token, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'FETCH_AND_UPLOAD') return;

  (async () => {
    const { payload, settings } = message;
    const token = settings?.notionToken?.trim();
    const pageId = settings?.pageId?.trim();

    if (!token || !pageId) {
      throw new Error('Notion設定が不足しています。');
    }

    if (!payload?.url) {
      throw new Error('PDF URLがありません。');
    }

    if (!allowedHostCheck(payload.url, settings.allowedHosts || [])) {
      throw new Error('このホストは許可リストに入っていません。');
    }

    const { blob, response, finalUrl } = await fetchPdfAsBlob(payload.url);
    const filename = guessFilename(payload, response, finalUrl);
    const fileUploadId = await uploadFileToNotion({ token, filename, blob });

    await appendPdfBlockToPage({
      token,
      pageId,
      fileUploadId,
      filename,
      sourceUrl: finalUrl || payload.url
    });

    sendResponse({
      ok: true,
      message: `NotionへPDF埋め込みを追加しました: ${filename}`
    });
  })().catch(error => {
    sendResponse({
      ok: false,
      error: error.message || String(error)
    });
  });

  return true;
});