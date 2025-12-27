class LineBuffer {
  constructor(onLine) {
    this.onLine = onLine;
    this.buffer = '';
  }

  push(chunk) {
    this.buffer += chunk;
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      this.onLine(line);
    }
  }

  flush() {
    const line = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    if (line) this.onLine(line);
  }
}

module.exports = { LineBuffer };

