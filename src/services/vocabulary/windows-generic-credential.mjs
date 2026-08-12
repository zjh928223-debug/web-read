import { execFileSync } from 'node:child_process'

const PYTHON_CREDENTIAL_READER = String.raw`
import ctypes, sys
from ctypes import wintypes

class FILETIME(ctypes.Structure):
    _fields_ = [('low', wintypes.DWORD), ('high', wintypes.DWORD)]

class CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ('Flags', wintypes.DWORD), ('Type', wintypes.DWORD), ('TargetName', wintypes.LPWSTR),
        ('Comment', wintypes.LPWSTR), ('LastWritten', FILETIME), ('CredentialBlobSize', wintypes.DWORD),
        ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)), ('Persist', wintypes.DWORD),
        ('AttributeCount', wintypes.DWORD), ('Attributes', ctypes.c_void_p),
        ('TargetAlias', wintypes.LPWSTR), ('UserName', wintypes.LPWSTR),
    ]

pointer_type = ctypes.POINTER(CREDENTIALW)
credential = pointer_type()
advapi = ctypes.WinDLL('Advapi32.dll')
advapi.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(pointer_type)]
advapi.CredReadW.restype = wintypes.BOOL
advapi.CredFree.argtypes = [ctypes.c_void_p]
if advapi.CredReadW(sys.argv[1], 1, 0, ctypes.byref(credential)):
    try:
        size = int(credential.contents.CredentialBlobSize or 0)
        if size:
            sys.stdout.write(ctypes.string_at(credential.contents.CredentialBlob, size).decode('utf-8'))
    finally:
        advapi.CredFree(credential)
`

export function readWindowsGenericCredential(targetName, options = {}) {
  if (process.platform !== 'win32' || !String(targetName || '').trim()) return ''
  try {
    return String(execFileSync(options.pythonPath || 'python', ['-c', PYTHON_CREDENTIAL_READER, targetName], {
      encoding: 'utf8',
      timeout: 4_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }) || '').trim()
  } catch {
    return ''
  }
}
