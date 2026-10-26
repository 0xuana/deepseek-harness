/** Cancel only after a real PTC process has dispatched its readiness tool. */
export const name = 'ptc-cancel-fixture'
export const inject = ['tools']
export function apply(ctx) {
  ctx.on('tools/result', (exec) => {
    if (exec.name === 'working_directory' && exec.parent !== undefined) {
      exec.agent.cancel({ kind: 'user' })
    }
  })
}
