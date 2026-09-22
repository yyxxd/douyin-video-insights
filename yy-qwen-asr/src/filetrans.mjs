import { filetransSubmit, taskQuery, fetchResultJson } from '../../qwen-media-runtime/src/bailian_client.mjs';
import { uploadTemporary } from '../../qwen-media-runtime/src/temp_upload.mjs';
import { RuntimeError } from '../../qwen-media-runtime/src/errors.mjs';

function taskError(task) {
  const code = task.output?.code || task.code;
  return new RuntimeError(task.output?.message || task.message || 'Filetrans 任务未成功。', code === 'FILE_DOWNLOAD_FAILED' ? code : 'FILETRANS_FAILED');
}

async function poll(config, taskId, endpoints) {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const task = await taskQuery(config, taskId, endpoints);
    const status = task.output?.task_status || task.output?.taskStatus;
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(status)) {
      if (status !== 'SUCCEEDED') throw taskError(task);
      const url = task.output?.result?.transcription_url || task.output?.transcription_url;
      if (!url) throw new RuntimeError('Filetrans 成功但未返回结果 JSON 地址。', 'FILETRANS_NO_RESULT');
      return fetchResultJson(config, url);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new RuntimeError('Filetrans 任务轮询超时，请核对服务端任务，不要直接重发。', 'FILETRANS_TIMEOUT');
}

async function submit(config, ossUrl, endpoints, hooks) {
  await hooks.beforeRequest();
  const submitted = await filetransSubmit(config, { model: config.asrLongModel, input: { file_url: ossUrl } }, endpoints);
  const taskId = submitted.output?.task_id || submitted.output?.taskId || submitted.task_id;
  if (!taskId) throw new RuntimeError('Filetrans 未返回任务 ID。', 'FILETRANS_NO_TASK');
  await hooks.remoteTask(taskId);
  return poll(config, taskId, endpoints);
}

export async function transcribeLong(config, probe, hooks) {
  const ossUrl = (await uploadTemporary(probe.file, config, config.asrLongModel)).ossUrl;
  return submit(config, ossUrl, config.workspaceEndpoints || config.endpoints, hooks);
}
