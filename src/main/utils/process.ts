import { exec, execFile, execFileSync, execSync } from 'child_process'
import { promisify } from 'util'

const execPromise = promisify(exec)
const execFilePromise = promisify(execFile)

type BufferLike = Buffer | string | null | undefined

const WINDOWS_OUTPUT_ENCODINGS = ['utf-8', 'ibm866', 'windows-1251'] as const

function scoreDecodedOutput(text: string): number {
  const replacementChars = (text.match(/\uFFFD/g) || []).length
  const cyrillicChars = (text.match(/[А-Яа-яЁё]/g) || []).length
  const asciiChars = (text.match(/[A-Za-z0-9]/g) || []).length
  const mojibakePairs =
    (text.match(/[РС][А-Яа-яЁё]/g) || []).length +
    (text.match(/[ÐÑ][A-Za-zÀ-ÿ]/g) || []).length +
    (text.match(/[╨╤]/g) || []).length

  return cyrillicChars * 4 + asciiChars - replacementChars * 100 - mojibakePairs * 25
}

function decodeBuffer(buffer: Buffer): string {
  if (process.platform !== 'win32') {
    return buffer.toString('utf8')
  }

  let best = buffer.toString('utf8')
  let bestScore = scoreDecodedOutput(best)

  for (const encoding of WINDOWS_OUTPUT_ENCODINGS) {
    try {
      const decoded = new TextDecoder(encoding).decode(buffer)
      const score = scoreDecodedOutput(decoded)
      if (score > bestScore) {
        best = decoded
        bestScore = score
      }
    } catch {
      // ignore unsupported encodings
    }
  }

  return best
}

export function decodeProcessOutput(value: BufferLike): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return decodeBuffer(value)
}

function createProcessError(error: unknown): Error {
  if (!error || typeof error !== 'object') {
    return new Error(String(error))
  }

  const message = 'message' in error ? String(error.message) : String(error)
  const stdout = 'stdout' in error ? decodeProcessOutput(error.stdout as BufferLike).trim() : ''
  const stderr = 'stderr' in error ? decodeProcessOutput(error.stderr as BufferLike).trim() : ''
  const details = [stderr, stdout].filter(Boolean).join('\n')

  return new Error(details || message)
}

export async function execText(
  command: string,
  options?: Parameters<typeof execPromise>[1]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = (await execPromise(command, {
      ...(options || {}),
      encoding: 'buffer'
    })) as { stdout: BufferLike; stderr: BufferLike }

    return {
      stdout: decodeProcessOutput(stdout),
      stderr: decodeProcessOutput(stderr)
    }
  } catch (error) {
    throw createProcessError(error)
  }
}

export async function execFileText(
  file: string,
  args: readonly string[] = [],
  options?: Parameters<typeof execFilePromise>[2]
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = (await execFilePromise(file, args, {
      ...(options || {}),
      encoding: 'buffer'
    })) as { stdout: BufferLike; stderr: BufferLike }

    return {
      stdout: decodeProcessOutput(stdout),
      stderr: decodeProcessOutput(stderr)
    }
  } catch (error) {
    throw createProcessError(error)
  }
}

export function execSyncText(
  command: string,
  options?: Parameters<typeof execSync>[1]
): string {
  return decodeProcessOutput(
    execSync(command, {
      ...(options || {}),
      encoding: 'buffer'
    }) as BufferLike
  ).trim()
}

export function execFileSyncText(
  file: string,
  args: readonly string[] = [],
  options?: Parameters<typeof execFileSync>[2]
): string {
  return decodeProcessOutput(
    execFileSync(file, args, {
      ...(options || {}),
      encoding: 'buffer'
    }) as BufferLike
  ).trim()
}
