/**
 * Prepare local-only fault bundles for installed Desktop qualification; never publish these packages.
 * Run `node apps/desktop/scripts/prepare-diagnostic-fixtures.mjs <output-directory>` with tar on PATH.
 * Each invocation creates a new directory containing six archives, their sources, and a test checklist.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const destination = process.argv[2]
if (destination === undefined) throw new Error('Provide an output directory for local diagnostic test bundles')
await mkdir(resolve(destination), { recursive: true })
const root = await mkdtemp(join(resolve(destination), 'diagnostic-fixtures-'))
const disabledBundle = 'dsh-test-diagnostic-disabled-services'
const delayMs = 10_000
const delayed = action => `export const inject = ['appReady'];
export function apply(ctx) {
  ctx.effect(() => {
    let timer;
    const dispose = ctx.appReady.onReady(() => {
      timer = setTimeout(() => { ${action} }, ${delayMs});
    });
    return () => { clearTimeout(timer); dispose(); };
  });
}
`
const fixtures = [
  {
    name: disabledBundle,
    description: 'Disables four core providers; startup must fail until this test bundle is disabled.',
    patch: ['agent', 'session', 'llm', 'tools'].map(id => `- id: ${id}\n  disabled: true`).join('\n') + '\n',
  },
  {
    name: 'dsh-test-diagnostic-import',
    description: 'Imports a failing module while agent-loop requires its unavailable fixture service.',
    patch: '- insert:\n    - id: diagnostic-import\n      name: ./fault.mjs\n- id: agent-loop\n  inject: [diagnosticFixtureReady]\n',
    source: 'throw new Error("DIAGNOSTIC_FIXTURE_IMPORT", { cause: new Error("DIAGNOSTIC_FIXTURE_IMPORT_CAUSE") });\n',
  },
  {
    name: 'dsh-test-diagnostic-initialize',
    description: 'Initializes a failing plugin while agent-loop requires its unavailable fixture service.',
    patch: '- insert:\n    - id: diagnostic-initialize\n      name: ./fault.mjs\n- id: agent-loop\n  inject: [diagnosticFixtureReady]\n',
    source: 'export function apply() { throw new Error("DIAGNOSTIC_FIXTURE_INITIALIZE", { cause: new Error("DIAGNOSTIC_FIXTURE_INITIALIZE_CAUSE") }); }\n',
  },
  {
    name: 'dsh-test-diagnostic-async',
    description: 'Throws asynchronously ten seconds after appReady; does not call a model provider.',
    patch: '- insert:\n    - id: diagnostic-async\n      name: ./fault.mjs\n',
    source: delayed('throw new Error("DIAGNOSTIC_FIXTURE_ASYNC", { cause: new Error("DIAGNOSTIC_FIXTURE_ASYNC_CAUSE") });'),
  },
  {
    name: 'dsh-test-diagnostic-exit',
    description: 'Exits the Host with code 23 ten seconds after appReady, without normal teardown.',
    patch: '- insert:\n    - id: diagnostic-exit\n      name: ./fault.mjs\n',
    source: delayed('process.stderr.write("DIAGNOSTIC_FIXTURE_EXIT\\n", () => process.exit(23));'),
  },
  {
    name: 'dsh-test-diagnostic-restart',
    description: 'Requires the disabled-services test package installed but unselected; enables it through pluginManager and then fails asynchronously.',
    patch: '- insert:\n    - id: diagnostic-restart\n      name: ./fault.mjs\n',
    source: delayed(`void ctx.pluginManager.setBundleEnabled('${disabledBundle}', true).then(result => {
      if (!['applied', 'restart-required'].includes(result.application)) throw new Error('DIAGNOSTIC_FIXTURE_UNEXPECTED_RESULT_' + result.application);
      throw new Error('DIAGNOSTIC_FIXTURE_RESTART_AFTER_CHANGE');
    });`).replace("['appReady']", "['appReady', 'pluginManager']"),
  },
]
const packages = []
for (const fixture of fixtures) {
  const directory = join(root, fixture.name)
  const contents = join(directory, 'package')
  await mkdir(contents, { recursive: true })
  await writeFile(join(contents, 'package.json'), JSON.stringify({
    name: fixture.name, version: '1.0.0', private: true, license: 'UNLICENSED', type: 'module',
    description: fixture.description, dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2) + '\n')
  await writeFile(join(contents, 'cordis.patch.yml'), fixture.patch)
  if (fixture.source !== undefined) await writeFile(join(contents, 'fault.mjs'), fixture.source)
  const archive = join(root, fixture.name + '-1.0.0.tgz')
  execFileSync('tar', ['-czf', archive, '-C', directory, 'package'], { windowsHide: true })
  packages.push({ name: fixture.name, archive, description: fixture.description })
}
await writeFile(join(root, 'fixtures.json'), JSON.stringify({ delayMs, packages }, null, 2) + '\n')
await writeFile(join(root, 'README.txt'), `Desktop 故障诊断手测夹具

仅用于隔离测试配置或虚拟机。不要安装到日常使用的配置，也不要发布这些包。
每个 .tgz 都是一个独立 bundle；源码位于同名目录的 package 子目录。
fixtures.json 记录包名、文件路径和故障类型。生成成功不代表客户端验收通过。

预期故障：
- disabled-services：禁用 agent、session、llm、tools 四个核心提供者，启动失败。
- import：模块导入抛错，并让 agent-loop 等待夹具服务；核对原始错误和缺失服务。
- initialize：插件初始化抛错，并让 agent-loop 等待夹具服务；核对 cause。
- async：appReady 后 10 秒抛出异步异常；核对原始错误和 cause。
- exit：appReady 后 10 秒将 Host 以退出码 23 结束；核对退出码和 stderr 标记。
- restart：要求 disabled-services 已安装但未启用；通过 pluginManager 启用它，接受即时应用或要求重启的成功结果后抛错，再次启动应出现核心提供者缺失。

每个独立场景从干净测试配置开始。restart 场景保留同一配置和日志跨两次启动。
appReady 不代表窗口已经显示；运行时场景必须另行观察实际就绪状态。
记录安装包版本和源码提交、插件操作结果、报告路径、hostRunId、操作记录、附加收集完成标记及耗时。
通过弹窗获取报告，确认文件可读。恢复操作后核对测试 bundle 已禁用，再验证客户端可启动。
原始插件输出只在需要时单独取用；提交工单前检查内容，不自动上传。
`)
console.log(JSON.stringify({ root, packages }, null, 2))
