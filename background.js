const NOTION_VERSION = '2023-11-06';

function sanitizePageId(pageId) {
  return (pageId || '').replace(/[^a-fA-F0-9]/g, '');
}

function allowedHostCheck(url, allowedHosts = []) {
  if (!allowedHosts.length) return true;
  const host = new URL(url).hostname;
  return allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function guessFilename(payload, response) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1].replace(/\"/g, ''));

  const fromUrl = new URL(payload.url).pathname.split('/').pop();
  if (fromUrl && fromUrl.includes('.')) return fromUrl;

  const title = payload.title || 'document';
  return `${title.replace(/[^\w.-]+/g, '_')}.pdf`;
}

async function fetchPdfAsBlob(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`PDF取得失敗: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
    const firstText = await response.clone().text().catch(() => '');
    throw new Error(`PDF以外の応答です。content-type=${contentType} ${firstText.slice(0, 80)}`);
  }

  return { blob: await response.blob(), response };
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

async function createSinglePartFileUpload({ token, filename, blob }) {
  const createPayload = {
    mode: 'single_part',
    filename,
    content_type: blob.type || 'application/pdf'
  };

  return notionFetch('/file_uploads', token, {
    method: 'POST',
    body: JSON.stringify(createPayload)
  });
}

function extractUploadInfo(created) {
  const uploadUrl =
    created?.upload_url ||
    created?.signed_put_url ||
    created?.file_upload?.upload_url ||
    created?.file_upload?.signed_put_url ||
    created?.file_upload?.url;

  const fileUploadId =
    created?.id ||
    created?.file_upload?.id;

  if (!uploadUrl || !fileUploadId) {
    throw new Error(
      'Notionのfile_upload作成応答から upload_url / id を取得できませんでした。API仕様変更の可能性があります。'
    );
  }

  return { uploadUrl, fileUploadId };
}

async function sendSinglePartFile({ uploadUrl, blob }) {
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'application/pdf'
    },
    body: blob
  });

  if (!put.ok) {
    const errorText = await put.text().catch(() => '');
    throw new Error(`Notionへの実ファイル送信に失敗しました: HTTP ${put.status} ${errorText.slice(0, 200)}`);
  }
}

async function uploadFileToNotion({ token, filename, blob }) {
  const created = await createSinglePartFileUpload({ token, filename, blob });
  const { uploadUrl, fileUploadId } = extractUploadInfo(created);
  await sendSinglePartFile({ uploadUrl, blob });
  return fileUploadId;
}

async function appendPdfBlockToPage({ token, pageId, fileUploadId, filename, sourceUrl }) {
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
        type: 'file',
        file: {
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

  return notionFetch(`/blocks/${sanitizePageId(pageId)}/children`, token, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'FETCH_AND_UPLOAD') return;

  (async () => {
    const { payload, settings } = message;
    const token = settings?.notionToken?.trim();
    const pageId = sanitizePageId(settings?.pageId?.trim());

    if (!token || !pageId) {
      throw new Error('Notion設定が不足しています。');
    }

    if (!payload?.url) {
      throw new Error('PDF URLがありません。');
    }

    if (!allowedHostCheck(payload.url, settings.allowedHosts || [])) {
      throw new Error('このホストは許可リストに入っていません。');
    }

    const { blob, response } = await fetchPdfAsBlob(payload.url);
    const filename = guessFilename(payload, response);
    const fileUploadId = await uploadFileToNotion({ token, filename, blob });

    await appendPdfBlockToPage({
      token,
      pageId,
      fileUploadId,
      filename,
      sourceUrl: payload.url
    });

    sendResponse({
      ok: true,
      message: `Notionへ送信しました: ${filename}`
    });
  })().catch(error => {
    sendResponse({
      ok: false,
      error: error.message || String(error)
    });
  });

  return true;
});