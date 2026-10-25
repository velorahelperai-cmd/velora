import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { basicLocalCheck, normalizeScope, reservePaths, releasePaths } from './guard.mjs';

export function writerRequest(argv, env = process.env) {
  const [action, ...args] = argv;
  if (!['acquire', 'release'].includes(action)) throw Error('WRITER_ACTION_INVALID');
  const option = name => {
    const inline = args.find(x => x.startsWith(`--${name}=`));
    if (inline) return inline.slice(name.length + 3);
    const at = args.indexOf(`--${name}`);
    return at >= 0 && !args[at + 1]?.startsWith('--') ? args[at + 1] : undefined;
  };
  const task = option('task') ?? env.VELORA_TASK_ID;
  if (typeof task !== 'string' || !task.trim()) throw Error('TASK_ID_REQUIRED');
  const paths = option('paths')?.split(',').filter(Boolean);
  if (action === 'acquire') {
    if (!paths?.length) throw Error('RESERVATION_INPUT_INVALID');
    paths.forEach(normalizeScope);
  }
  // --handoff may accompany an owner-approved path transfer, but never grants
  // authority to release another owner's lease or to acquire the whole tree.
  return { action, task, paths };
}

export function runWriterRequest(request, env = process.env,
  api = { basicLocalCheck, reservePaths, releasePaths }) {
  if (!['acquire', 'release'].includes(request?.action)) throw Error('WRITER_ACTION_INVALID');
  if (typeof request.task !== 'string' || !request.task.trim()) throw Error('TASK_ID_REQUIRED');
  const owner = api.basicLocalCheck(env);
  return request.action === 'acquire'
    ? api.reservePaths({ owner, task: request.task, paths: request.paths })
    : api.releasePaths({ owner, task: request.task });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(runWriterRequest(writerRequest(process.argv.slice(2)))));
  } catch (error) {
    console.error(JSON.stringify({ stage: 'writer_ownership', error_code:
      /^[A-Z_]+$/.test(error.message) ? error.message : 'WRITER_OPERATION_FAILED' }));
    process.exitCode = 1;
  }
}
