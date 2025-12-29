async function postJson(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const msg = typeof body?.msg === 'string' ? body.msg : text;
    throw new Error(`PUSHPLUS_HTTP_${res.status}${msg ? `: ${msg}` : ''}`);
  }

  return body;
}

async function sendPushPlus({ endpoint, token, title, content, template, channel }) {
  if (!token) throw new Error('PUSHPLUS_TOKEN_MISSING');
  if (!endpoint) throw new Error('PUSHPLUS_ENDPOINT_MISSING');

  const payload = {
    token,
    title: String(title || '').slice(0, 180) || 'auto_codex',
    content: String(content || ''),
    template: String(template || 'markdown'),
    channel: String(channel || 'wechat'),
  };

  const body = await postJson(endpoint, payload);
  const code = Number.isFinite(Number(body?.code)) ? Number(body.code) : null;
  if (code !== 200) {
    const msg = typeof body?.msg === 'string' ? body.msg : '';
    throw new Error(`PUSHPLUS_CODE_${code ?? 'unknown'}${msg ? `: ${msg}` : ''}`);
  }

  return body;
}

module.exports = { sendPushPlus };

