import { RuntimeError } from './errors.mjs';

const values = new Set(['file', 'output', 'task-id', 'operation-id', 'approved-cost-ceiling']);
const flags = new Set(['confirm', 'json', 'debug', 'finalize-task']);
const camel = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export function parseModelArgs(args, kind) {
  const allowedValues = new Set([...values, ...(kind === 'asr' ? ['language'] : ['prompt', 'prompt-file'])]);
  const allowedFlags = new Set([...flags, ...(kind === 'asr' ? ['timestamps', 'no-itn'] : ['force-temp-upload'])]);
  const options = { files: [], operationIds: [], itn: true };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const name = args[index].slice(2);
    if (!args[index].startsWith('--') || (!allowedValues.has(name) && !allowedFlags.has(name))) throw new RuntimeError(`无效参数：${args[index]}`, 'USAGE');
    if (seen.has(name) && !['file', 'operation-id'].includes(name)) throw new RuntimeError(`重复参数：--${name}`, 'USAGE');
    seen.add(name);
    const value = allowedFlags.has(name) ? true : args[++index];
    if (value === undefined || value === '' || (typeof value === 'string' && value.startsWith('--'))) throw new RuntimeError(`缺少参数值：--${name}`, 'USAGE');
    if (name === 'file') options.files.push(value);
    else if (name === 'operation-id') options.operationIds.push(value);
    else if (name === 'no-itn') options.itn = false;
    else options[camel(name)] = value;
  }
  if (!options.files.length) throw new RuntimeError('需要 --file <本地媒体路径>。', 'USAGE');
  if (options.operationIds.length && options.operationIds.length !== options.files.length) throw new RuntimeError('--operation-id 数量必须与文件数量一致。', 'USAGE');
  if (new Set(options.operationIds).size !== options.operationIds.length) throw new RuntimeError('Operation ID 不能重复。', 'USAGE');
  if (options.approvedCostCeiling !== undefined) {
    options.approvedCostCeiling = Number(options.approvedCostCeiling);
    if (!options.confirm || !Number.isFinite(options.approvedCostCeiling) || options.approvedCostCeiling < 0) throw new RuntimeError('授权金额须为非负有限数，并与 --confirm 一起使用。', 'USAGE');
  }
  return options;
}

export function printReport(report, options) {
  if (options.json || options.debug || report.requiresConfirmation) return console.log(JSON.stringify(report, null, 2));
  const cost = report.actualTotalCost ?? report.estimatedTotalCost;
  const label = report.actualTotalCost === null ? '预估费用' : '本次费用';
  console.log(`已调用：${report.skill}\n${label}：${cost === null ? '无法可靠计算' : `约 ¥${cost.toFixed(4)}（按配置价格计算，非账单）`}`);
  for (const result of report.results) console.log(`\n媒体时长：${result.durationSeconds.toFixed(2)} 秒\n${result.text ?? result.content}`);
  for (const warning of report.warnings || []) console.error(`提示：${warning}`);
}
