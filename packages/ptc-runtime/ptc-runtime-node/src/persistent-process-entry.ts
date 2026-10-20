/** Private built entry for retained Node evaluations. */
import { openInheritedControlChannel } from '@deepseek-ai/dsh-subprocess/control'
import { runPersistentMain } from './persistent-process.ts'

const format = process.argv[3] ?? 'repl'
if (format !== 'function-body' && format !== 'repl' && format !== 'script') throw new Error(`unsupported persistent PTC format: ${format}`)
void runPersistentMain(openInheritedControlChannel(), Number(process.argv[2]), process, format)
