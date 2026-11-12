from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import deploy


class DeploymentTest(unittest.TestCase):
    def fixture(self, root):
        for path, content in {
            "BE/target/myworkspace-0.0.1-SNAPSHOT.jar": "fixture jar",
            "FE/dist/index.html": "new frontend",
            "FE/deploy/nginx.conf": "new nginx",
            "BE/deploy/myworkspace.service": "new service",
        }.items():
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)

    def test_failure_at_each_activation_stage_restores_all_previous_parts(self):
        for failure in ["nginx-test", "restart", "readiness", "frontend", "reload"]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.fixture(root)
                links = {deploy.JAR_LINK: "old.jar", deploy.FE_LINK: "old-fe"}
                files = {deploy.NGINX: "old nginx", deploy.SERVICE: "old service"}
                triggered = False

                def run(ct, args):
                    nonlocal triggered
                    if args[0] == "sh":
                        if args[2].startswith("readlink"):
                            return links[args[2].split()[1]]
                        return "yes"
                    if args[0] == "cp" and args[1] == "-a":
                        files[args[-1]] = files[args[-2]]
                    point = None
                    if args == ["nginx", "-t"]:
                        point = "nginx-test"
                    if args == ["systemctl", "restart", "myworkspace"]:
                        point = "restart"
                    if args[0] == "ln" and args[-1] == deploy.FE_LINK:
                        point = "frontend"
                    if args == ["systemctl", "reload", "nginx"]:
                        point = "reload"
                    if point == failure and not triggered:
                        triggered = True
                        raise subprocess.CalledProcessError(1, args)
                    if args[0] == "ln":
                        links[args[-1]] = args[-2]
                    return ""

                def private_file(ct, path, text, mode):
                    files[path] = text

                readiness = [False, True] if failure == "readiness" else [True, True]
                with patch.object(deploy, "run", side_effect=run), patch.object(deploy, "private_file", side_effect=private_file), patch.object(deploy, "ready", side_effect=readiness), patch.object(deploy.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"/run/myworkspace-deploy-fixture\n")):
                    with self.assertRaises((RuntimeError, subprocess.CalledProcessError)):
                        deploy.deploy(root)
                self.assertEqual("old.jar", links[deploy.JAR_LINK])
                self.assertEqual("old-fe", links[deploy.FE_LINK])
                self.assertEqual("old nginx", files[deploy.NGINX])
                self.assertEqual("old service", files[deploy.SERVICE])

    def test_success_publishes_both_versions_and_cleans_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            calls = []
            def run(ct, args):
                calls.append(args)
                return "yes" if args[0] == "sh" else ""
            with patch.object(deploy, "run", side_effect=run), patch.object(deploy, "private_file"), patch.object(deploy, "ready", return_value=True), patch.object(deploy.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, b"/run/myworkspace-deploy-fixture\n")):
                deploy.deploy(root)
            self.assertTrue(any(c[0] == "ln" and c[-1] == deploy.JAR_LINK for c in calls))
            self.assertTrue(any(c[0] == "ln" and c[-1] == deploy.FE_LINK for c in calls))
            self.assertEqual(["rm", "-rf", "/run/myworkspace-deploy-fixture"], calls[-1])


if __name__ == "__main__":
    unittest.main()
