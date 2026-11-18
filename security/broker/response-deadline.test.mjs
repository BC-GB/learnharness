import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startBroker } from './server.mjs';

for (const [responseMs, idleMs, expectedCode] of [
  [1000, 50, 'broker_idle_timeout'],
  [50, 1000, 'broker_response_timeout'],
]) {
  test(`a streaming response reports ${expectedCode} and closes upstream`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-deadline-'));
    const requestSocket = path.join(dir, 'request');
    let markClosed;
    const upstreamClosed = new Promise(resolve => { markClosed = resolve; });
    const provider = http.createServer((req, res) => {
      req.resume();
      res.on('close', markClosed);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"type":"response.in_progress"}\n\n');
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    const broker = await startBroker({
      requestSocket, controlSocket: path.join(dir, 'control'), stateDir: path.join(dir, 'state'),
      mode: 'mock', requireReview: false, mockPort: provider.address().port, mockHost: '127.0.0.1',
      responseMs, idleMs,
    });
    try {
      const body = JSON.stringify({ model: 'synthetic', input: [], store: false, stream: true });
      const response = await new Promise((resolve, reject) => {
        const req = http.request({
          socketPath: requestSocket, path: '/v1/responses', method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        }, async res => {
          try {
            let text = '';
            for await (const chunk of res) text += chunk;
            resolve({ status: res.statusCode, text });
          } catch (error) { reject(error); }
        });
        req.on('error', reject);
        req.end(body);
      });
      assert.equal(response.status, 200);
      assert.match(response.text, /response.in_progress/);
      assert.match(response.text, new RegExp(expectedCode));
      assert.doesNotMatch(response.text, /response.completed/);
      await upstreamClosed;
    } finally {
      await broker.close();
      await new Promise(resolve => provider.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
