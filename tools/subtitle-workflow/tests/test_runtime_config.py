import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from youtube_workflow.runtime_config import RuntimeConfigError, load_runtime_config


class RuntimeConfigTests(unittest.TestCase):
    def write_config(self, root: Path, payload: dict) -> Path:
        path = root / "runtime.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_file_and_environment_resolve_one_versioned_runtime(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = self.write_config(root, {
                "schemaVersion": 1,
                "frontend": {"host": "127.0.0.1", "port": 5174},
                "backend": {"host": "127.0.0.1", "port": 8766},
                "dataRoot": "./workflow-data",
                "python": {"executable": "python"},
                "tools": {"ytDlp": "./bin/yt-dlp.exe", "whisperx": "./bin/whisperx.exe", "ffmpeg": "ffmpeg", "cookies": "./private/cookies.txt"},
                "network": {"proxyUrl": "http://127.0.0.1:7897"},
                "ai": {"model": "gemini-file-model", "baseUrl": "https://example.test/gemini"},
            })
            runtime = load_runtime_config(config_path, env={"READ_WEB_BACKEND_PORT": "9876", "GEMINI_MODEL": "gemini-env-model"})
            self.assertEqual(runtime.schema_version, 1)
            self.assertEqual(runtime.frontend_url, "http://127.0.0.1:5174/")
            self.assertEqual(runtime.backend_url, "http://127.0.0.1:9876")
            self.assertEqual(runtime.health_url, "http://127.0.0.1:9876/api/health")
            self.assertEqual(runtime.data_root, (root / "workflow-data").resolve())
            self.assertEqual(runtime.yt_dlp_path, (root / "bin/yt-dlp.exe").resolve())
            self.assertEqual(runtime.ffmpeg_path, Path("ffmpeg"))
            self.assertEqual(runtime.model, "gemini-env-model")

            selected = load_runtime_config(
                config_path,
                env={
                    "READ_WEB_PYTHON": "./python/canonical.exe",
                    "READ_WEB_PYTHON_PATH": "./python/compatibility-alias.exe",
                },
            )
            self.assertEqual(selected.python_executable, (root / "python/canonical.exe").resolve())

    def test_unknown_schema_version_and_unknown_fields_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            version_path = self.write_config(root, {"schemaVersion": 2})
            with self.assertRaisesRegex(RuntimeConfigError, "schemaVersion"):
                load_runtime_config(version_path, env={})
            unknown_path = self.write_config(root, {"schemaVersion": 1, "backend": {"port": 8766, "secret": "no"}})
            with self.assertRaisesRegex(RuntimeConfigError, "backend.secret"):
                load_runtime_config(unknown_path, env={})

    def test_private_lan_runtime_config_is_explicit_and_keeps_optimization_boundary(self):
        repository_root = Path(__file__).resolve().parents[3]
        runtime = load_runtime_config(repository_root / "config" / "runtime.private-lan.json", env={})

        self.assertEqual(runtime.profile_id, "optimization")
        self.assertEqual(runtime.transport_mode, "private-lan")
        self.assertEqual(runtime.configured_lan_host, "192.168.1.20")
        self.assertEqual(runtime.frontend_host, runtime.configured_lan_host)
        self.assertEqual(runtime.frontend_port, 5184)
        self.assertEqual(runtime.frontend_public_url, "http://192.168.1.20:5184/")
        self.assertEqual(runtime.backend_host, "127.0.0.1")
        self.assertEqual(runtime.backend_port, 8776)
        self.assertEqual(runtime.data_root, Path(r"E:\ReadWebData\SubtitleWorkflow-Optimization"))

    def test_windows_style_environment_variables_resolve_portable_tool_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = self.write_config(root, {
                "schemaVersion": 1,
                "tools": {
                    "whisperx": "%READ_WEB_TOOL_ROOT%\\whisperx\\Scripts\\whisperx.exe",
                },
            })
            runtime = load_runtime_config(
                config_path,
                env={"READ_WEB_TOOL_ROOT": str(root / "external-tools")},
            )
            self.assertEqual(
                runtime.whisperx_path,
                (root / "external-tools" / "whisperx" / "Scripts" / "whisperx.exe").resolve(),
            )

    def test_diagnostics_redact_credentials_queries_and_user_home(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config_path = self.write_config(root, {
                "schemaVersion": 1,
                "dataRoot": str(Path.home() / "private-workflow"),
                "network": {"proxyUrl": "http://reader:proxy-secret@proxy.test:7897?token=hidden"},
                "ai": {"baseUrl": "https://ai.test/v1?key=api-secret"},
            })
            diagnostics = json.dumps(load_runtime_config(config_path, env={}).diagnostics(), ensure_ascii=False)
            self.assertNotIn("proxy-secret", diagnostics)
            self.assertNotIn("api-secret", diagnostics)
            self.assertNotIn(str(Path.home()), diagnostics)
            self.assertIn("***", diagnostics)
            self.assertIn("<USER_HOME>", diagnostics)

    def test_workflow_config_defaults_are_resolved_at_instance_creation(self):
        from youtube_workflow.core import WorkflowConfig
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            data_root = root / "runtime-data"
            config_path = self.write_config(root, {
                "schemaVersion": 1,
                "dataRoot": str(data_root),
                "tools": {"ffmpeg": "runtime-ffmpeg"},
                "network": {"proxyUrl": "http://127.0.0.1:7999"},
            })
            with patch.dict(os.environ, {"READ_WEB_RUNTIME_CONFIG": str(config_path)}, clear=False):
                config = WorkflowConfig()
            self.assertEqual(config.output_dir, data_root / "output")
            self.assertEqual(config.state_dir, data_root / ".workflow_state")
            self.assertEqual(config.ffmpeg_path, Path("runtime-ffmpeg"))
            self.assertEqual(config.proxy_url, "http://127.0.0.1:7999")


if __name__ == "__main__":
    unittest.main()
