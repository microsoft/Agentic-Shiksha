import ast
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SECRET_NAME_PARTS = ("SECRET", "PASSWORD", "API_KEY", "CONNECTION_STRING")


def _is_os_getenv(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "os"
        and node.func.attr == "getenv"
    )


class SecretConfigurationTests(unittest.TestCase):
    def test_auth_import_requires_jwt_secret(self) -> None:
        environment = os.environ.copy()
        environment.pop("JWT_SECRET", None)
        environment["PYTHONPATH"] = str(ROOT)

        with tempfile.TemporaryDirectory() as working_directory:
            result = subprocess.run(
                [sys.executable, "-c", "import auth"],
                cwd=working_directory,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("JWT_SECRET is required", result.stderr)

    def test_secret_environment_reads_have_no_nonempty_defaults(self) -> None:
        findings: list[str] = []

        for path in ROOT.rglob("*.py"):
            if any(part in {".venv", "venv", "__pycache__"} for part in path.parts):
                continue

            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                    continue

                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                value = node.value
                if value is None or not _is_os_getenv(value) or len(value.args) < 2:
                    continue

                names = [target.id for target in targets if isinstance(target, ast.Name)]
                if not any(part in name.upper() for name in names for part in SECRET_NAME_PARTS):
                    continue

                default = value.args[1]
                if isinstance(default, ast.Constant) and default.value in (None, ""):
                    continue

                relative_path = path.relative_to(ROOT).as_posix()
                findings.append(f"{relative_path}:{node.lineno}:{','.join(names)}")

        self.assertEqual(findings, [], "Secret fallbacks found at: " + "; ".join(findings))


if __name__ == "__main__":
    unittest.main()