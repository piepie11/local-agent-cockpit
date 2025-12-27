function writeSse(res, { id, event, data }) {
  if (id !== undefined && id !== null) res.write(`id: ${id}\n`);
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

class SseHub {
  constructor({ store }) {
    this.store = store;
    this.clientsByRun = new Map();
  }

  subscribe({ runId, req, res, lastEventId }) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const afterSeq = Number.isFinite(Number(lastEventId)) ? Number(lastEventId) : 0;
    const backlog = this.store.listEventsAfter(runId, afterSeq);
    for (const evt of backlog) {
      writeSse(res, { id: evt.seq, event: 'event', data: evt });
    }

    const set = this.clientsByRun.get(runId) ?? new Set();
    set.add(res);
    this.clientsByRun.set(runId, set);

    req.on('close', () => {
      const current = this.clientsByRun.get(runId);
      if (!current) return;
      current.delete(res);
      if (current.size === 0) this.clientsByRun.delete(runId);
    });

    writeSse(res, { id: afterSeq, event: 'ready', data: { runId } });
  }

  broadcast(runId, evt) {
    const set = this.clientsByRun.get(runId);
    if (!set) return;
    for (const res of set) {
      writeSse(res, { id: evt.seq, event: 'event', data: evt });
    }
  }
}

module.exports = { SseHub };

