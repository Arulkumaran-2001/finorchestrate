// Runs the API server and the dashboard dev server together, on any OS.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tasks = [
  { name: 'server', color: '\x1b[36m', args: ['run', 'dev', '--workspace', '@finorchestrate/server'] },
  { name: 'web', color: '\x1b[35m', args: ['run', 'dev', '--workspace', '@finorchestrate/web'] },
];

const children = tasks.map((task) => {
  const child = spawn(npm, task.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: process.env });
  const prefix = `${task.color}[${task.name}]\x1b[0m `;
  const pipe = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
