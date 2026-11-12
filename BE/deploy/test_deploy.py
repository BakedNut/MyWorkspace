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

    def test_first_deployment_rollback_removes_new_service_without_enabling_it(self):
        previous = {"jar": "", "frontend": "", "service": False, "active": False, "enabled": False, "nginx_active": False}
        with patch.object(deploy, "run", return_value="") as run, patch.object(deploy, "ready") as ready:
            self.assertEqual([], deploy.restore(previous, "/run/myworkspace-deploy-fixture"))
        commands = [call.args[1] for call in run.call_args_list]
        self.assertIn(["rm", "-f", deploy.JAR_LINK], commands)
        self.assertIn(["rm", "-f", deploy.FE_LINK], commands)
        self.assertIn(["rm", "-f", deploy.SERVICE], commands)
        disable = next(i for i, command in enumerate(commands) if command[0] == "sh" and "disable" in command[2])
        self.assertLess(disable, commands.index(["rm", "-f", deploy.SERVICE]))
        self.assertNotIn(["systemctl", "enable", "myworkspace"], commands)
        ready.assert_not_called()

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
