export class RuntimeError extends Error {
  constructor(message, code = 'RUNTIME_ERROR', details = undefined) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
}

function safeMessage(message) {
  return String(message || '').replace(/oss:\/\/[^\s"'`]+/gi, 'oss://<redacted>').replace(/Bearer\s+[^\s]+/gi, 'Bearer <redacted>');
}

export function printError(error, json = false) {
  const payload = { ok: false, code: error.code || 'ERROR', error: safeMessage(error.message) };
  console.error(json ? JSON.stringify(payload) : `失败：${safeMessage(error.message)}`);
}
