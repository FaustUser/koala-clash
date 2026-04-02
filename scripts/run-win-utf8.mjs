import { spawn } from 'node:child_process'

const args = process.argv.slice(2)

if (args.length === 0) {
  console.error('Usage: node scripts/run-win-utf8.mjs <command> [...args]')
  process.exit(1)
}

const quoteWindowsArg = (value) => {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

const child =
  process.platform === 'win32'
    ? spawn(
        'cmd.exe',
        ['/d', '/s', '/c', `chcp 65001>nul && ${args.map(quoteWindowsArg).join(' ')}`],
        {
          stdio: 'inherit'
        }
      )
    : spawn(args[0], args.slice(1), {
        stdio: 'inherit'
      })

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})
