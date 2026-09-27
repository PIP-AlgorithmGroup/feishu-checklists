const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');

function createLocalDevEnvironment(shellEnv, localEnv, defaultEnv) {
  const env = { ...defaultEnv, ...localEnv, ...shellEnv,
    NODE_ENV: 'development', MIAODA_LOCAL_DEV: '1', MIAODA_APP_TYPE: '3' };
  env.CLIENT_DEV_HOST = env.CLIENT_DEV_HOST || '127.0.0.1';
  try {
    let user;
    try {
      user = JSON.parse(env.SUDA_WEBUSER);
    } catch {
      user = JSON.parse(env.SUDA_WEBUSER?.replace(/\\"/g, '"'));
    }
    if (!user?.user_id) throw new Error('Missing user identity');
    env.SUDA_WEBUSER = JSON.stringify(user);
  } catch {
    throw new Error('SUDA_WEBUSER 缺失或无效，请先运行 lark-cli apps +env-pull --app-id <app-id> --as user');
  }
  return env;
}

function startLocalDev(env, spawnProcess = spawn) {
  const options = { cwd: root, env, stdio: 'inherit', shell: false, windowsHide: true };
  return [
    spawnProcess(process.execPath, [require.resolve('@nestjs/cli/bin/nest.js'), 'start', '--watch'], options),
    spawnProcess(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
      '--config', 'vite.config.ts'], options),
  ];
}

if (require.main === module) {
  const readEnv = (name) => {
    const file = path.join(root, name);
    return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
  };
  try {
    const env = createLocalDevEnvironment(process.env, readEnv('.env.local'), readEnv('.env'));
    const children = startLocalDev(env);
    const stop = () => children.forEach((child) => child.kill());
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    children.forEach((child) => {
      child.on('error', (error) => {
        process.stderr.write(`启动开发服务失败：${error.message}\n`);
        process.exitCode = 1;
        stop();
      });
      child.on('exit', (code) => {
        if (code !== 0 && code !== null) process.exitCode = code;
        stop();
      });
    });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createLocalDevEnvironment, startLocalDev };
