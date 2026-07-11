import ctypes
import os
from ctypes import wintypes


class CredentialStoreError(RuntimeError):
    pass


class UnavailableCredentialStore:
    provider = "unavailable"

    def get_secret(self) -> str:
        return ""

    def set_secret(self, _value: str) -> None:
        raise CredentialStoreError("system credential storage is not available on this platform")

    def delete_secret(self) -> None:
        return None

    def has_secret(self) -> bool:
        return False


if os.name == "nt":
    CRED_TYPE_GENERIC = 1
    CRED_PERSIST_LOCAL_MACHINE = 2

    class FILETIME(ctypes.Structure):
        _fields_ = [
            ("dwLowDateTime", wintypes.DWORD),
            ("dwHighDateTime", wintypes.DWORD),
        ]

    class CREDENTIALW(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    PCREDENTIALW = ctypes.POINTER(CREDENTIALW)
    advapi32 = ctypes.WinDLL("Advapi32.dll")
    advapi32.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(PCREDENTIALW)]
    advapi32.CredReadW.restype = wintypes.BOOL
    advapi32.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIALW), wintypes.DWORD]
    advapi32.CredWriteW.restype = wintypes.BOOL
    advapi32.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    advapi32.CredDeleteW.restype = wintypes.BOOL
    advapi32.CredFree.argtypes = [ctypes.c_void_p]
    advapi32.CredFree.restype = None

    class WindowsCredentialStore:
        provider = "windows-credential-manager"

        def __init__(self, target_name: str = "SubtitleWorkflow/GeminiApiKey"):
            self.target_name = target_name

        def get_secret(self) -> str:
            credential = PCREDENTIALW()
            if not advapi32.CredReadW(self.target_name, CRED_TYPE_GENERIC, 0, ctypes.byref(credential)):
                return ""
            try:
                blob_size = int(credential.contents.CredentialBlobSize or 0)
                if blob_size <= 0:
                    return ""
                raw = ctypes.string_at(credential.contents.CredentialBlob, blob_size)
                return raw.decode("utf-8")
            finally:
                advapi32.CredFree(credential)

        def set_secret(self, value: str) -> None:
            secret = str(value or "").strip()
            if not secret:
                raise CredentialStoreError("apiKey is required")
            blob = secret.encode("utf-8")
            blob_buffer = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
            credential = CREDENTIALW()
            credential.Type = CRED_TYPE_GENERIC
            credential.TargetName = self.target_name
            credential.CredentialBlobSize = len(blob)
            credential.CredentialBlob = ctypes.cast(blob_buffer, ctypes.POINTER(ctypes.c_ubyte))
            credential.Persist = CRED_PERSIST_LOCAL_MACHINE
            credential.UserName = "Gemini API key"
            if not advapi32.CredWriteW(ctypes.byref(credential), 0):
                raise CredentialStoreError("failed to write Windows credential")

        def delete_secret(self) -> None:
            advapi32.CredDeleteW(self.target_name, CRED_TYPE_GENERIC, 0)

        def has_secret(self) -> bool:
            return bool(self.get_secret())

else:
    WindowsCredentialStore = UnavailableCredentialStore


def default_credential_store():
    if os.name == "nt":
        return WindowsCredentialStore()
    return UnavailableCredentialStore()
