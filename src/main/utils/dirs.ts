import { is } from '@electron-toolkit/utils'
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { app } from 'electron'
import path from 'path'
import { getAppConfigSync } from '../config/app'
import { checkCorePermissionSync } from '../core/manager'
import { t } from './i18n'
import { execFileSyncText, execSyncText } from './process'

export const homeDir = app.getPath('home')

function runtimeNamespace(): string {
  return is.dev ? 'koala-clash-dev' : 'koala-clash'
}

export function isPortable(): boolean {
  return existsSync(path.join(exeDir(), 'PORTABLE'))
}

export function dataDir(): string {
  if (isPortable()) {
    return path.join(exeDir(), 'data')
  } else {
    return app.getPath('userData')
  }
}

export function taskDir(): string {
  const dir = path.join(app.getPath('userData'), 'tasks')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function exeDir(): string {
  return path.dirname(exePath())
}

export function exePath(): string {
  return app.getPath('exe')
}

export function resourcesDir(): string {
  if (is.dev) {
    return path.join(__dirname, '../../extra')
  } else {
    if (app.getAppPath().endsWith('asar')) {
      return process.resourcesPath
    } else {
      return path.join(app.getAppPath(), 'resources')
    }
  }
}

export function resourcesFilesDir(): string {
  return path.join(resourcesDir(), 'files')
}

export function themesDir(): string {
  return path.join(dataDir(), 'themes')
}

export function mihomoIpcPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${runtimeNamespace()}\\mihomo`
  }
  const { core = 'mihomo' } = getAppConfigSync()
  if (core === 'system') {
    return `/tmp/${runtimeNamespace()}-mihomo-external.sock`
  }
  if (!checkCorePermissionSync(core as 'mihomo' | 'mihomo-alpha')) {
    return `/tmp/${runtimeNamespace()}-mihomo-api-noperm.sock`
  }
  return `/tmp/${runtimeNamespace()}-mihomo-api.sock`
}

export function serviceIpcPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\sparkle\\${runtimeNamespace()}-service`
  }
  return `/tmp/${runtimeNamespace()}-service.sock`
}

export function mihomoCoreDir(): string {
  return path.join(resourcesDir(), 'sidecar')
}

export function mihomoCorePath(core: string): string {
  if (core === 'mihomo' || core === 'mihomo-alpha') {
    const isWin = process.platform === 'win32'
    return path.join(mihomoCoreDir(), `${core}${isWin ? '.exe' : ''}`)
  }
  if (core === 'system') {
    const sysPath = systemCorePath()
    if (!sysPath || !existsSync(sysPath)) {
      const errorMsg = sysPath
        ? `${t('error.systemCorePathInvalid')}: ${sysPath}`
        : t('error.systemCorePathNotSet')
      throw new Error(errorMsg)
    }
    return sysPath
  }
  throw new Error(t('error.corePathError'))
}

function systemCorePath(): string {
  const { systemCorePath = '' } = getAppConfigSync()
  return systemCorePath
}

export function servicePath(): string {
  const isWin = process.platform === 'win32'
  return path.join(resourcesFilesDir(), `sparkle-service${isWin ? '.exe' : ''}`)
}

export function appConfigPath(): string {
  return path.join(dataDir(), 'config.yaml')
}

export function controledMihomoConfigPath(): string {
  return path.join(dataDir(), 'mihomo.yaml')
}

export function profileConfigPath(): string {
  return path.join(dataDir(), 'profile.yaml')
}

export function profilesDir(): string {
  return path.join(dataDir(), 'profiles')
}

export function profilePath(id: string): string {
  return path.join(profilesDir(), `${id}.yaml`)
}

export function mihomoWorkDir(): string {
  return path.join(dataDir(), 'work')
}

export function mihomoProfileWorkDir(id: string | undefined): string {
  return path.join(mihomoWorkDir(), id || 'default')
}

export function mihomoTestDir(): string {
  return path.join(dataDir(), 'test')
}

export function mihomoWorkConfigPath(id: string | undefined): string {
  if (id === 'work') {
    return path.join(mihomoWorkDir(), 'config.yaml')
  } else {
    return path.join(mihomoProfileWorkDir(id), 'config.yaml')
  }
}

export function logDir(): string {
  return path.join(dataDir(), 'logs')
}

export function logPath(): string {
  const date = new Date()
  const name = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  return path.join(logDir(), `${name}.log`)
}

export function rendererDiagnosticsPath(): string {
  const date = new Date()
  const name = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  return path.join(logDir(), `renderer-${name}.log`)
}

export function rulesDir(): string {
  return path.join(dataDir(), 'rules')
}

export function rulePath(): string {
  return path.join(rulesDir(), 'shared.yaml')
}

export function legacyRulePath(id: string): string {
  return path.join(rulesDir(), `${id}.yaml`)
}

function hasCommand(command: string): boolean {
  if (process.platform === 'win32') {
    return findWindowsPaths(command).length > 0
  }

  try {
    execSyncText(`which ${command}`, { stdio: 'pipe' })
    return true
  } catch (error) {
    return false
  }
}

function findWindowsPaths(command: string): string[] {
  try {
    const result = execFileSyncText('where.exe', [command], {
      stdio: 'pipe',
      windowsHide: true
    })
    return result
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter((p) => p && existsSync(p))
  } catch {
    return []
  }
}

export function findSystemMihomo(): string[] {
  const isWin = process.platform === 'win32'
  const isLinux = process.platform === 'linux'
  const isMac = process.platform === 'darwin'
  const foundPaths: string[] = []
  const searchNames = ['mihomo', 'clash']

  for (const name of searchNames) {
    try {
      if (isWin) {
        const paths = findWindowsPaths(name)
        for (const p of paths) {
          if (!foundPaths.includes(p)) {
            foundPaths.push(p)
          }
        }
      } else {
        const result = execSyncText(`which ${name}`)
        if (result) {
          const paths = result.split('\n').filter((p) => p && existsSync(p))
          for (const p of paths) {
            if (!foundPaths.includes(p)) {
              foundPaths.push(p)
            }
          }
        }
      }
    } catch (error) {
      // ignore
    }
  }

  if (!isWin) {
    const commonDirs = [
      '/bin',
      '/usr/bin',
      '/usr/local/bin',
      path.join(homeDir, '.local/bin'),
      path.join(homeDir, 'bin')
    ]

    for (const dir of commonDirs) {
      if (existsSync(dir)) {
        try {
          const files = readdirSync(dir)
          for (const file of files) {
            if (file.startsWith('mihomo') || file.startsWith('clash')) {
              const binPath = path.join(dir, file)
              if (existsSync(binPath) && !foundPaths.includes(binPath)) {
                foundPaths.push(binPath)
              }
            }
          }
        } catch (error) {
          // ignore
        }
      }
    }
  }

  if (isMac || isLinux) {
    // Homebrew
    if (hasCommand('brew')) {
      for (const name of searchNames) {
        try {
          const result = execSyncText(`brew --prefix ${name} 2>/dev/null`)
          if (result) {
            const binPath = path.join(result, 'bin', name)
            if (existsSync(binPath) && !foundPaths.includes(binPath)) {
              foundPaths.push(binPath)
            }
          }
        } catch (error) {
          // ignore
        }
      }
    }
  }

  if (isLinux) {
    // apt/dpkg (Debian/Ubuntu)
    if (hasCommand('dpkg')) {
      for (const name of searchNames) {
        try {
          const result = execSyncText(`dpkg -L ${name} 2>/dev/null | grep bin/${name}$`)
          if (result) {
            const paths = result.split('\n').filter((p) => p && existsSync(p))
            for (const p of paths) {
              if (!foundPaths.includes(p)) {
                foundPaths.push(p)
              }
            }
          }
        } catch (error) {
          // ignore
        }
      }
    }

    // rpm/yum (RedHat/CentOS/Fedora)
    if (hasCommand('rpm')) {
      for (const name of searchNames) {
        try {
          const result = execSyncText(`rpm -ql ${name} 2>/dev/null | grep bin/${name}$`)
          if (result) {
            const paths = result.split('\n').filter((p) => p && existsSync(p))
            for (const p of paths) {
              if (!foundPaths.includes(p)) {
                foundPaths.push(p)
              }
            }
          }
        } catch (error) {
          // ignore
        }
      }
    }

    // pacman (Arch Linux)
    if (hasCommand('pacman')) {
      for (const name of searchNames) {
        try {
          const result = execSyncText(`pacman -Ql ${name} 2>/dev/null | grep bin/${name}$`)
          if (result) {
            const paths = result
              .split('\n')
              .map((line) => line.split(' ')[1])
              .filter((p) => p && existsSync(p))
            for (const p of paths) {
              if (!foundPaths.includes(p)) {
                foundPaths.push(p)
              }
            }
          }
        } catch (error) {
          // ignore
        }
      }
    }
  }

  if (isWin) {
    // Scoop
    if (hasCommand('scoop')) {
      for (const name of searchNames) {
        try {
          const result = execFileSyncText('scoop', ['which', name], {
            stdio: 'pipe',
            windowsHide: true
          })
          if (result && existsSync(result) && !foundPaths.includes(result)) {
            foundPaths.push(result)
          }
        } catch (error) {
          // ignore
        }
      }
    }
  }

  return Array.from(new Set(foundPaths)).sort()
}
