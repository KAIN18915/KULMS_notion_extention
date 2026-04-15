function absolutize(url) {
  try {
    return new URL(url, location.href).href;
  } catch {
    return null;
  }
}

function guessPdfLinks() {
  const anchors = [...document.querySelectorAll('a[href]')];
  const results = [];
  const seen = new Set();

  for (const a of anchors) {
    const href = a.getAttribute('href');
    const abs = absolutize(href);
    if (!abs || seen.has(abs)) continue;

    const text = (a.textContent || '').trim();
    const title = (a.getAttribute('title') || '').trim();
    const looksLikePdf = /\.pdf($|[?#])/i.test(abs) || /pdf/i.test(text) || /pdf/i.test(title);
    if (!looksLikePdf) continue;

    seen.add(abs);
    results.push({
      url: abs,
      title: text || title || abs.split('/').pop() || 'document.pdf'
    });
  }

  const embeds = [...document.querySelectorAll('iframe[src], embed[src], object[data]')];
  for (const node of embeds) {
    const raw = node.getAttribute('src') || node.getAttribute('data');
    const abs = absolutize(raw);
    if (!abs || seen.has(abs)) continue;
    if (!/pdf|\.pdf($|[?#])/i.test(abs)) continue;
    seen.add(abs);
    results.push({
      url: abs,
      title: document.title || 'embedded-document.pdf'
    });
  }

  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SCAN_PDFS') {
    try {
      const items = guessPdfLinks();
      sendResponse({ ok: true, items });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  }
  return true;
});
