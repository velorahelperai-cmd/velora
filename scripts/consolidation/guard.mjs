
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync, constants, existsSync, readFileSync,
  realpathSync, mkdirSync, rmdirSync, writeFileSync, renameSync
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = 'C:\\Users\\DELL\\Desktop\\Velora new';
export const ORIGIN = 'https://github.com/velorahelperai-cmd/velora.git';
export const REPOSITORY = 'velorahelperai-cmd/velora';
export const WRITER_SCOPE = 'explicit-path-reservations';

const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
const requireThat = (condition, code) => {
  if (!condition) throw Error(code);
};
const ownerValid = value =>
  typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value);

// All cooperating agents must reserve files before editing.
// This guard cannot intercept writes made outside its reservation system.
export function normalizeScope(value) {
  requireThat(typeof value === 'string' && value.length > 0, 'INVALID_PATH_SCOPE');
  const s = value.replaceAll('\\', '/');
  requireThat(!s.startsWith('/') && !/^[A-Za-z]:/.test(s) && !s.includes('\0'), 'INVALID_PATH_SCOPE');
  const directory = s.endsWith('/**');
  const p = directory ? s.slice(0, -3) : s;
  requireThat(
    p.length > 0 && p !== '.' && p !== '..' &&
    !p.includes('*') &&
    !p.split('/').some(x => !x || x === '.' || x === '..'),
    'INVALID_PATH_SCOPE'
  );
  const normalized = p.toLowerCase();
  requireThat(normalized !== '.git' && !normalized.startsWith('.git/'), 'GIT_METADATA_RESERVED');
  return normalized + (directory ? '/**' : '');
}

const contains = (scope, target) => scope.endsWith('/**')
  ? (target === scope.slice(0, -3) || target.startsWith(scope.slice(0, -2)))
  : target === scope;

export function overlaps(a, b) {
  const x = normalizeScope(a), y = normalizeScope(b);
  return contains(x, y.endsWith('/**') ? y.slice(0, -3) : y)
    || contains(y, x.endsWith('/**') ? x.slice(0, -3) : x);
}

export function reservationFingerprint(registry) {
  const reservations = registry.reservations.map(x => ({
    owner: x.owner, task: x.task, paths: [...x.paths].sort(),
    publicationBase: x.publicationBase ?? null,
  })).sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return createHash('sha256').update(JSON.stringify({
    reservations, deliveryOwner: registry.deliveryOwner ?? null,
    deliveryTask: registry.deliveryTask ?? null,
  })).digest('hex');
}

export function deliveryIdentityFingerprint(registry, owner = registry.deliveryOwner, task = registry.deliveryTask) {
  const selected = registry.reservations.filter(x => x.owner === owner && x.task === task);
  requireThat(selected.length === 1, 'TASK_RESERVATION_REQUIRED');
  requireThat(sha(selected[0].publicationBase), 'PUBLICATION_BASE_REQUIRED');
  requireThat(Array.isArray(selected[0].paths) && selected[0].paths.length > 0
    && selected[0].paths.every(path => normalizeScope(path) === path), 'RESERVATION_REGISTRY_INVALID');
  return reservationFingerprint({ reservations: selected, deliveryOwner: owner, deliveryTask: task });
}

export function allowedDeliveryScopes(registry) {
  if (!registry.deliveryOwner) return [];
  const selected = registry.reservations.find(x => x.owner === registry.deliveryOwner && x.task === registry.deliveryTask);
  requireThat(selected, 'TASK_RESERVATION_REQUIRED');
  const recorded = registry.deliveryMutableScopes ?? [];
  requireThat(Array.isArray(recorded), 'RESERVATION_REGISTRY_INVALID');
  const others = registry.reservations.filter(x => x !== selected).flatMap(x => x.paths);
  const scopes = [...new Set([...recorded, ...others].map(normalizeScope))].sort();
  requireThat(!scopes.some(scope => selected.paths.some(path => overlaps(scope, path))), 'DELIVERY_PATH_CONFLICT');
  return scopes;
}

export function validateWorkspace(c, { delivery = false } = {}) {
  const e = c.env ?? {};

  if (e.GITHUB_ACTIONS === 'true') {
    requireThat(c.platform === 'linux', 'PLATFORM_MISMATCH');
    requireThat(e.GITHUB_REPOSITORY === REPOSITORY, 'REPOSITORY_MISMATCH');
    requireThat(c.origin === ORIGIN || c.origin === ORIGIN.slice(0, -4), 'ORIGIN_MISMATCH');
    requireThat(c.workspaceMatches, 'GIT_ROOT_MISMATCH');
    requireThat(sha(e.GITHUB_SHA) && c.head === e.GITHUB_SHA, 'COMMIT_MISMATCH');
    requireThat(
      e.GITHUB_REF === 'refs/heads/main' ||
      (e.GITHUB_EVENT_NAME === 'pull_request' && e.GITHUB_BASE_REF === 'main') ||
      (e.GITHUB_EVENT_NAME === 'merge_group' &&
        e.GITHUB_REF?.startsWith('refs/heads/gh-readonly-queue/main/')),
      'BRANCH_MISMATCH'
    );
    return {
      stage: 'workspace_guard',
      mode: 'github_ci',
      repository: REPOSITORY,
      commit: c.head
    };
  }

  if (e.VERCEL === '1') {
    requireThat(c.platform === 'linux', 'PLATFORM_MISMATCH');
    requireThat(
      e.VERCEL_GIT_PROVIDER === 'github' &&
      e.VERCEL_GIT_REPO_OWNER === 'velorahelperai-cmd' &&
      e.VERCEL_GIT_REPO_SLUG === 'velora',
      'REPOSITORY_MISMATCH'
    );
    requireThat(
      ['production', 'preview'].includes(e.VERCEL_ENV) &&
      sha(e.VERCEL_GIT_COMMIT_SHA),
      'DEPLOYMENT_SOURCE_MISSING'
    );
    requireThat(e.VERCEL_GIT_COMMIT_REF === 'main', 'BRANCH_MISMATCH');
    return {
      stage: 'workspace_guard',
      mode: 'vercel_build',
      repository: REPOSITORY,
      commit: e.VERCEL_GIT_COMMIT_SHA
    };
  }

  requireThat(c.platform === 'win32', 'PLATFORM_MISMATCH');
  requireThat(c.directoryMatches, 'WORKING_DIRECTORY_MISMATCH');
  requireThat(c.gitRootMatches && c.commonDirectoryMatches, 'GIT_ROOT_MISMATCH');
  requireThat(c.origin === ORIGIN, 'ORIGIN_MISMATCH');
  requireThat(c.branch === 'main', 'BRANCH_MISMATCH');
  requireThat(c.account === 'velorahelperai-cmd', 'GITHUB_ACCOUNT_MISMATCH');
  requireThat(c.writable, 'WORKSPACE_PERMISSION_DENIED');
  requireThat(ownerValid(c.writer), 'WRITER_ID_INVALID');

  requireThat(
    !(c.status ?? '').split('\n').some(line =>
      /^(UU|AA|DD|AU|UA|DU|UD) /.test(line)
    ),
    'UNRESOLVED_INDEX_CONFLICT'
  );

  requireThat(
    c.registry?.schemaVersion === 2 &&
    Array.isArray(c.registry?.reservations),
    'RESERVATION_REGISTRY_INVALID'
  );

  const mine = c.registry.reservations.filter(x => x.owner === c.writer);
  requireThat(mine.length > 0, 'PATH_RESERVATION_REQUIRED');
  for (let i = 0; i < c.registry.reservations.length; i++) {
    const a = c.registry.reservations[i];
    requireThat(
      ownerValid(a.owner) &&
      typeof a.task === 'string' &&
      a.task.trim().length > 0 &&
      Array.isArray(a.paths) && a.paths.length > 0 &&
      a.paths.every(p => normalizeScope(p) === p),
      'RESERVATION_REGISTRY_INVALID'
    );

    for (let j = i + 1; j < c.registry.reservations.length; j++) {
      const b = c.registry.reservations[j];
      if (a.owner !== b.owner) {
        requireThat(
          !a.paths.some(p => b.paths.some(q => overlaps(p, q))),
          'OVERLAPPING_RESERVATIONS'
        );
      }
    }
  }

  const taskNames = [...new Set(mine.map(x => x.task))];
  const task = c.task || (taskNames.length === 1 ? taskNames[0] : null);
  requireThat(typeof task === 'string' && task.trim().length > 0, 'TASK_ID_REQUIRED');
  const selected = mine.filter(x => x.task === task);
  requireThat(selected.length === 1, 'TASK_RESERVATION_REQUIRED');
  requireThat(sha(selected[0].publicationBase), 'PUBLICATION_BASE_REQUIRED');
  if (delivery) {
    requireThat(c.registry.deliveryOwner === c.writer && c.registry.deliveryTask === task,
      'DELIVERY_OWNERSHIP_REQUIRED');
    requireThat(
      c.registry.deliveryReservationFingerprint === deliveryIdentityFingerprint(c.registry, c.writer, task),
      'DELIVERY_RESUME_IDENTITY_CHANGED');
  }

  return {
    stage: 'workspace_guard',
    mode: 'local',
    error_code: null,
    root: ROOT,
    branch: 'main',
    owner: c.writer,
    task,
    publicationBase: selected[0].publicationBase,
    reservationFingerprint: delivery ? deliveryIdentityFingerprint(c.registry, c.writer, task) : reservationFingerprint(c.registry),
    tasks: taskNames,
    paths: selected[0].paths,
    mutableScopes: delivery ? allowedDeliveryScopes(c.registry) : []
  };
}

export function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }).trim();
}

const same = (a, b) =>
  realpathSync(resolve(a)).toLowerCase() ===
  realpathSync(resolve(b)).toLowerCase();

const registryPath = () =>
  resolve(ROOT, '.git', 'velora-path-reservations.json');

const mutexPath = () =>
  resolve(ROOT, '.git', 'velora-path-reservations.mutex');

const emptyRegistry = () => ({
  schemaVersion: 2,
  reservations: [],
  deliveryOwner: null,
  deliveryTask: null
});

function readRegistry(bytes) {
  const file = registryPath();
  const data = bytes !== undefined
    ? (bytes === null ? emptyRegistry() : JSON.parse(bytes))
    : existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : emptyRegistry();

  requireThat(
    data.schemaVersion === 2 &&
    Array.isArray(data.reservations) &&
    ((data.deliveryOwner === null && data.deliveryTask == null) ||
      (ownerValid(data.deliveryOwner) && typeof data.deliveryTask === 'string' && data.deliveryTask.trim())),
    'RESERVATION_REGISTRY_INVALID'
  );
  return data;
}


// Read bytes once so the evidence hash and reported state describe the same observation.
export function reservationStatus(env = process.env) {
  const file = registryPath();
  const bytes = existsSync(file) ? readFileSync(file) : null;
  const registry = readRegistry(bytes);
  const owner = env.VELORA_WRITER_ID ?? env.CODEX_THREAD_ID;
  const task = env.VELORA_TASK_ID;
  const deliveryState = !registry.deliveryOwner ? 'unclaimed'
    : registry.deliveryOwner !== owner ? 'foreign'
      : registry.deliveryTask === task ? 'owned' : 'same-owner-other-task';
  return { ...registry, observedAt: new Date().toISOString(), registryPath: file,
    registryExists: bytes !== null,
    registrySha256: bytes === null ? null : createHash('sha256').update(bytes).digest('hex'),
    observerOwner: owner ?? null, observerTask: task ?? null, deliveryState,
    ownReservationCount: registry.reservations.filter(x => x.owner === owner).length,
    foreignReservationCount: registry.reservations.filter(x => x.owner !== owner).length };
}

function writeRegistry(value) {
  const file = registryPath();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  renameSync(tmp, file);
}

// Atomic registry mutex; fail closed if already locked.
function mutateRegistry(fn) {
  try {
    mkdirSync(mutexPath());
  } catch {
    throw Error('REGISTRY_BUSY');
  }

  try {
    const current = readRegistry();
    const result = fn(current);
    writeRegistry(current);
    return result;
  } finally {
    rmdirSync(mutexPath());
  }
}

function writerFrom(env = process.env) {
  const writer = env.VELORA_WRITER_ID ?? env.CODEX_THREAD_ID;
  requireThat(ownerValid(writer), 'WRITER_ID_INVALID');
  return writer;
}

export function basicLocalCheck(env = process.env) {
  requireThat(process.platform === 'win32', 'PLATFORM_MISMATCH');
  requireThat(same(process.cwd(), ROOT), 'WORKING_DIRECTORY_MISMATCH');
  requireThat(
    same(git('rev-parse', '--show-toplevel'), ROOT),
    'GIT_ROOT_MISMATCH'
  );
  requireThat(
    same(git('rev-parse', '--git-common-dir'), resolve(ROOT, '.git')),
    'GIT_ROOT_MISMATCH'
  );
  requireThat(git('remote', 'get-url', 'origin') === ORIGIN, 'ORIGIN_MISMATCH');
  requireThat(git('branch', '--show-current') === 'main', 'BRANCH_MISMATCH');
  requireThat(
    git('config', '--get', 'credential.username') === 'velorahelperai-cmd',
    'GITHUB_ACCOUNT_MISMATCH'
  );
  return writerFrom(env);
}

export function reservePaths({ owner, task, paths }) {
  requireThat(
    ownerValid(owner) &&
    typeof task === 'string' &&
    task.trim().length > 0,
    'RESERVATION_INPUT_INVALID'
  );
  requireThat(
    Array.isArray(paths) && paths.length > 0,
    'RESERVATION_INPUT_INVALID'
  );

  const requested = [...new Set(paths.map(normalizeScope))];
  const publicationBase = git('rev-parse', 'HEAD');
  requireThat(sha(publicationBase), 'PUBLICATION_BASE_REQUIRED');

  return mutateRegistry(r => {
    if (r.deliveryOwner) {
      const frozen = r.reservations.find(x => x.owner === r.deliveryOwner && x.task === r.deliveryTask);
      requireThat(frozen, 'TASK_RESERVATION_REQUIRED');
      if (owner === r.deliveryOwner && task === r.deliveryTask) {
        requireThat(requested.every(path => frozen.paths.includes(path)), 'DELIVERY_SCOPE_FROZEN');
        return { owner, task, paths: requested };
      }
      requireThat(!requested.some(path => frozen.paths.some(scope => overlaps(path, scope))), 'DELIVERY_PATH_CONFLICT');
    }

    for (const other of r.reservations.filter(x => x.owner !== owner)) {
      requireThat(
        !requested.some(p => other.paths.some(q => overlaps(p, q))),
        'PATH_ALREADY_RESERVED'
      );
    }

    const current = r.reservations.find(
      x => x.owner === owner && x.task === task
    );

    if (current) {
      current.paths = [...new Set([...current.paths, ...requested])];
      // Explicit same-owner re-reservation upgrades existing v2 records once.
      // Never reset a previously recorded baseline during normal reservation growth.
      if (!current.publicationBase) current.publicationBase = publicationBase;
    } else {
      r.reservations.push({
        owner,
        task,
        paths: requested,
        publicationBase,
        acquiredAt: new Date().toISOString()
      });
    }

    if (r.deliveryOwner) r.deliveryMutableScopes = allowedDeliveryScopes(r);
    return { owner, task, paths: requested };
  });
}

export function releasePaths({ owner, task }) {
  return mutateRegistry(r => {
    requireThat(!(r.deliveryOwner === owner && r.deliveryTask === task), 'DELIVERY_IN_PROGRESS');

    const previous = r.reservations.length;
    r.reservations = r.reservations.filter(
      x => !(x.owner === owner && x.task === task)
    );

    requireThat(
      r.reservations.length !== previous,
      'RESERVATION_NOT_FOUND'
    );
    return { owner, task, released: true };
  });
}

export function claimDelivery(owner, task) {
  requireThat(ownerValid(owner), 'WRITER_ID_INVALID');
  requireThat(typeof task === 'string' && task.trim().length > 0, 'TASK_ID_REQUIRED');

  return mutateRegistry(r => {
    const alreadyOwned = r.deliveryOwner === owner && r.deliveryTask === task;
    requireThat(!r.deliveryOwner || alreadyOwned, 'DELIVERY_ALREADY_CLAIMED');

    // One publisher owns the index/HEAD; disjoint working scopes remain writable.
    const selected = r.reservations.filter(x => x.owner === owner && x.task === task);
    requireThat(selected.length === 1, 'TASK_RESERVATION_REQUIRED');
    requireThat(sha(selected[0].publicationBase), 'PUBLICATION_BASE_REQUIRED');
    for (const reservation of r.reservations) {
      requireThat(Array.isArray(reservation.paths) && reservation.paths.length > 0
        && reservation.paths.every(path => normalizeScope(path) === path), 'RESERVATION_REGISTRY_INVALID');
    }
    if (alreadyOwned) requireThat(
      typeof r.deliveryReservationFingerprint === 'string'
        && r.deliveryReservationFingerprint === deliveryIdentityFingerprint(r, owner, task),
      'DELIVERY_RESUME_IDENTITY_CHANGED');
    r.deliveryOwner = owner;
    r.deliveryTask = task;
    r.deliveryReservationFingerprint = deliveryIdentityFingerprint(r, owner, task);
    if (!alreadyOwned) r.deliveryMutableScopes = [];
    r.deliveryMutableScopes = allowedDeliveryScopes(r);
    return {
      deliveryOwner: owner,
      deliveryTask: task,
      alreadyOwned,
      note: 'Review completed files before staging. Commit and push require explicit approval.'
    };
  });
}

export function endDelivery(owner) {
  return mutateRegistry(r => {
    requireThat(
      r.deliveryOwner === owner,
      'DELIVERY_OWNERSHIP_MISMATCH'
    );
    r.deliveryOwner = null;
    r.deliveryTask = null;
    delete r.deliveryReservationFingerprint;
    delete r.deliveryMutableScopes;
    return { deliveryOwner: null, deliveryTask: null };
  });
}

export function readLocalContext(env = process.env) {
  const directoryMatches = same(process.cwd(), ROOT);
  requireThat(directoryMatches, 'WORKING_DIRECTORY_MISMATCH');

  let writable = true;
  try {
    accessSync(ROOT, constants.W_OK);
    accessSync(resolve('.git'), constants.W_OK);
  } catch {
    writable = false;
  }

  return {
    env,
    platform: process.platform,
    directoryMatches,
    gitRootMatches: same(git('rev-parse', '--show-toplevel'), ROOT),
    commonDirectoryMatches: same(
      git('rev-parse', '--git-common-dir'),
      resolve(ROOT, '.git')
    ),
    origin: git('remote', 'get-url', 'origin'),
    branch: git('branch', '--show-current'),
    account: git('config', '--get', 'credential.username'),
    writable,
    status: git('status', '--porcelain=v1', '--untracked-files=normal'),
    writer: env.VELORA_WRITER_ID ?? env.CODEX_THREAD_ID,
    task: env.VELORA_TASK_ID,
    registry: readRegistry()
  };
}

export function verifyWorkspace(env = process.env, options = {}) {
  let c;

  if (env.GITHUB_ACTIONS === 'true') {
    c = {
      env,
      platform: process.platform,
      origin: git('remote', 'get-url', 'origin'),
      head: git('rev-parse', 'HEAD'),
      workspaceMatches:
        !!env.GITHUB_WORKSPACE &&
        same(git('rev-parse', '--show-toplevel'), env.GITHUB_WORKSPACE)
    };
  } else if (env.VERCEL === '1') {
    c = { env, platform: process.platform };
  } else {
    c = readLocalContext(env);
  }

  return validateWorkspace(c, options);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command = 'verify', ...args] = process.argv.slice(2);
    let result;

    if (command === 'verify') {
      result = verifyWorkspace();
    } else if (command === 'status') {
      basicLocalCheck();
      result = reservationStatus();
    } else {
      const owner = basicLocalCheck();

      if (command === 'acquire') {
        const task = args.find(x => x.startsWith('--task='))?.slice(7);
        const raw = args.find(x => x.startsWith('--paths='))?.slice(8);
        result = reservePaths({ owner, task, paths: raw?.split(',') });
      } else if (command === 'release') {
        const task = args.find(x => x.startsWith('--task='))?.slice(7);
        result = releasePaths({ owner, task });
      } else if (command === 'delivery-start') {
        const task = args.find(x => x.startsWith('--task='))?.slice(7) ?? process.env.VELORA_TASK_ID;
        result = claimDelivery(owner, task);
      } else if (command === 'delivery-end') {
        result = endDelivery(owner);
      } else {
        throw Error('UNKNOWN_COMMAND');
      }
    }

    console.log(JSON.stringify(result));
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message)
      ? error.message
      : 'WORKSPACE_VERIFICATION_FAILED';

    console.error(JSON.stringify({
      stage: 'workspace_guard',
      error_code: code
    }));

    process.exitCode = 1;
  }
}
