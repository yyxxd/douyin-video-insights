import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { PassThrough, Writable } from 'node:stream';
import { uploadTemporary } from '../../qwen-media-runtime/scripts/temp_upload.mjs';

const originalRequest = https.request;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-upload-test-'));
const file = path.join(directory, 'sample.mp4');
await fs.writeFile(file, 'test-media');
const config = {apiKey:'test-only', region:'cn-beijing', endpoints:{temporaryUploadPolicy:'https://policy.invalid/uploads'}};

async function verifyDirectory(uploadDir, targetModel) {
  let uploadedBody = '';
  let requests = 0;
  https.request = (url, options, callback) => {
    requests += 1;
    const isPolicy = url.hostname === 'policy.invalid';
    if (isPolicy) assert.equal(url.searchParams.get('model'), targetModel);
    return new Writable({
      write(chunk, encoding, done) { if (!isPolicy) uploadedBody += chunk.toString(); done(); },
      final(done) {
        const response = new PassThrough();
        response.statusCode = 200;
        callback(response);
        response.end(isPolicy ? JSON.stringify({data:{upload_host:'https://upload.invalid', upload_dir:uploadDir, policy:'test', signature:'test', oss_access_key_id:'test', x_oss_object_acl:'private', x_oss_forbid_overwrite:'true'}}) : '');
        done();
      },
    });
  };
  const result = await uploadTemporary(file, config, targetModel);
  const key = uploadedBody.match(/name="key"\r\n\r\n([^\r]+)/)?.[1];
  assert.match(key, /^temporary\/account\/[\w-]+-sample\.mp4$/);
  assert.equal(result.ossUrl, `oss://${key}`);
  assert.equal(requests, 2);
  assert.ok(uploadedBody.includes('test-media'));
}

try {
  for (const model of ['qwen3.8-omni-flash', 'qwen3-asr-flash-filetrans']) {
    for (const dir of ['temporary/account', 'temporary/account/', 'temporary/account//']) await verifyDirectory(dir, model);
  }
  console.log('TEMP_UPLOAD_CASES_OK: 6 cases');
} finally {
  https.request = originalRequest;
  await fs.unlink(file);
  await fs.rmdir(directory);
}
