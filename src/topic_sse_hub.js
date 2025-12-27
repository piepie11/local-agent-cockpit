function writeSse(res, { event, data }) {
  if (event) res.write(`event: ${event}\n`);
  if (data !== undefined) res.write(`data: ${JSON.stringify(data)}\n\n`);
  else res.write(`data: {}\n\n`);
}

function writeSseComment(res, comment) {
  const c = String(comment || '').replaceAll('\n', ' ');
  res.write(`: ${c}\n\n`);
}

class TopicSseHub {
  constructor({ heartbeatMs = 25_000 } = {}) {
    this.clientsByTopic = new Map();
    this.heartbeatMs = Number.isFinite(Number(heartbeatMs)) ? Number(heartbeatMs) : 25_000;
    this._heartbeatTimer = null;
  }

  _ensureHeartbeat() {
    if (this._heartbeatTimer) return;
    if (!this.heartbeatMs || this.heartbeatMs <= 0) return;
    this._heartbeatTimer = setInterval(() => {
      for (const set of this.clientsByTopic.values()) {
        for (const res of set) {
          try {
            writeSseComment(res, 'ping');
          } catch {}
        }
      }
    }, this.heartbeatMs);
    this._heartbeatTimer.unref?.();
  }

  _maybeStopHeartbeat() {
    if (!this._heartbeatTimer) return;
    for (const set of this.clientsByTopic.values()) {
      if (set && set.size) return;
    }
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }

  subscribe({ topic, req, res }) {
    const key = String(topic || '').trim();
    if (!key) throw new Error('TOPIC_REQUIRED');

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const set = this.clientsByTopic.get(key) ?? new Set();
    set.add(res);
    this.clientsByTopic.set(key, set);
    this._ensureHeartbeat();

    req.on('close', () => {
      const current = this.clientsByTopic.get(key);
      if (!current) return;
      current.delete(res);
      if (current.size === 0) this.clientsByTopic.delete(key);
      this._maybeStopHeartbeat();
    });

    writeSse(res, { event: 'ready', data: { topic: key } });
  }

  broadcast(topic, payload) {
    const key = String(topic || '').trim();
    if (!key) return;
    const set = this.clientsByTopic.get(key);
    if (!set || set.size === 0) return;
    for (const res of set) {
      try {
        writeSse(res, { event: 'event', data: payload });
      } catch {}
    }
  }
}

module.exports = { TopicSseHub };

