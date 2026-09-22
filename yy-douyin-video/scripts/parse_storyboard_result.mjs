import { argumentsOf, readJson, writeJson } from '../src/common.mjs';
import { validateMedia, speechTimeline } from '../src/contracts.mjs';
import { parseStoryboardResult } from '../src/parse_storyboard_result.mjs';

async function main() {
  const options = argumentsOf(process.argv.slice(2), ['omni', 'media', 'asr', 'out']);
  if (!options.omni || !options.media || !options.out) throw new Error('需要 --omni、--media、--out，可选 --asr。');
  const media = validateMedia(await readJson(options.media));
  const segments = speechTimeline(media, options.asr ? await readJson(options.asr) : null);
  await writeJson(options.out, parseStoryboardResult(await readJson(options.omni), media, segments));
  console.log(JSON.stringify({ ok: true, output: options.out }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
