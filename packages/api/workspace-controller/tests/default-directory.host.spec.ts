import { describe, expect, it, vi } from 'vitest'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { defaultWorkspaceDirectory, validateDocumentsDirectory } from '../src/default-directory.ts'

describe('system Documents directory', () => {
  it.each([
    ['darwin', '/Users/a/文档/\n', '/Users/a/文档/deepseek-harness/default-workspace', 'osascript'],
    ['win32', 'D:\\Redirected Documents\r\n', 'D:\\Redirected Documents\\deepseek-harness\\default-workspace', 'powershell.exe'],
    ['linux', '/home/a/My Documents\n', '/home/a/My Documents/deepseek-harness/default-workspace', 'xdg-user-dir'],
  ] as const)('uses the %s account directory and preserves spaces and Unicode', async (platform, stdout, path, command) => {
    const run = vi.fn<NativeCommandRunner>(async () => ({ stdout, stderr: '' }))
    const signal = new AbortController().signal
    await expect(defaultWorkspaceDirectory(undefined, signal, { platform, run })).resolves.toBe(path)
    expect(run).toHaveBeenCalledWith(command, expect.any(Array), signal, 'hidden')
  })

  it('uses the configured directory without a system lookup', async () => {
    const run = vi.fn<NativeCommandRunner>()
    await expect(defaultWorkspaceDirectory('/documents', new AbortController().signal, { platform: 'linux', run }))
      .resolves.toBe('/documents/deepseek-harness/default-workspace')
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['', '\r\n', '/home/a\n'])('falls back to the filesystem root for an unavailable XDG directory %j', async (stdout) => {
    const run: NativeCommandRunner = async () => ({ stdout, stderr: '' })
    await expect(defaultWorkspaceDirectory(undefined, new AbortController().signal, { platform: 'linux', home: '/home/a', run }))
      .resolves.toBe('/deepseek-harness/default-workspace')
  })

  it('falls back to the filesystem root on lookup failure, and still rejects cancellation', async () => {
    const run: NativeCommandRunner = async () => { throw new Error('lookup denied') }
    await expect(defaultWorkspaceDirectory(undefined, new AbortController().signal, { platform: 'darwin', run }))
      .resolves.toBe('/deepseek-harness/default-workspace')
    await expect(defaultWorkspaceDirectory('/documents', AbortSignal.abort(), { platform: 'linux' }))
      .rejects.toThrow()
    await expect(defaultWorkspaceDirectory(undefined, new AbortController().signal, { platform: 'freebsd' }))
      .resolves.toBe('/deepseek-harness/default-workspace')
  })

  it('seeds the directory from DSH_DOCUMENTS_DIRECTORY before any lookup', async () => {
    vi.stubEnv('DSH_DOCUMENTS_DIRECTORY', '/data')
    try {
      const run = vi.fn<NativeCommandRunner>()
      await expect(defaultWorkspaceDirectory(undefined, new AbortController().signal, { platform: 'linux', run }))
        .resolves.toBe('/data/deepseek-harness/default-workspace')
      expect(run).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each(['relative', 'C:relative', '\\rooted'])('rejects a Windows path without a fully qualified root: %s', (path) => {
    expect(() => validateDocumentsDirectory(path, 'win32')).toThrow('fully qualified')
  })

  it('accepts redirected UNC Documents directories', () => {
    expect(validateDocumentsDirectory('\\\\server\\share\\Documents', 'win32')).toBe('\\\\server\\share\\Documents')
    expect(() => validateDocumentsDirectory('relative', 'linux')).toThrow('fully qualified')
  })
})
