"""Settings -> SMARAN Code -> Git: the preferences are applied and Safe Git is actually enforced."""
import pytest

from app.agent import git_policy as gp

PREFS = {"branch_prefix": "feat/", "merge_method": "squash", "draft_prs": True}


@pytest.mark.parametrize("command", [
    "git push --force",
    "git push -f origin main",
    "git push origin main --force-with-lease",
    "git push origin +main",
    "git push -uf origin main",
    "git push origin --delete old",
    "git push origin :old",
    "git -C repo push --force",
    "npm test && git push -f",
    "git filter-branch --tree-filter x",
    "git filter-repo --path secret",
    "git reset --hard HEAD~3",
    "git reflog expire --expire=now --all",
    "git update-ref -d refs/heads/main",
    "gh pr merge 12 --admin",
])
def test_destructive_git_is_refused(command):
    with pytest.raises(gp.GitRefused):
        gp.apply(command, PREFS)


@pytest.mark.parametrize("command", [
    "git status", "git add -A", 'git commit -m "fix: login"', "git push", "git push -u origin feat/x",
    "git pull --rebase", "git log --oneline -5", "npm run build",
])
def test_ordinary_commands_pass_unchanged(command):
    assert gp.apply(command, PREFS) == command


def test_new_branches_get_the_prefix():
    assert gp.apply("git checkout -b login", PREFS) == "git checkout -b feat/login"
    assert gp.apply("git switch -c login", PREFS) == "git switch -c feat/login"
    assert gp.apply("git branch login", PREFS) == "git branch feat/login"
    assert gp.apply("git checkout -b feat/login", PREFS) == "git checkout -b feat/login"
    assert gp.apply("git branch -d old", PREFS) == "git branch -d old"
    assert gp.apply("git checkout main", PREFS) == "git checkout main"
    assert gp.apply("git checkout -b x", dict(PREFS, branch_prefix="")) == "git checkout -b x"
    assert gp.apply("git checkout -b x", dict(PREFS, branch_prefix="smaran")) == "git checkout -b smaran/x"


def test_merges_follow_the_chosen_method():
    assert gp.apply("git merge feat/x", PREFS) == "git merge --squash feat/x"
    assert gp.apply("git merge --no-ff feat/x", dict(PREFS, merge_method="merge")) == "git merge --no-ff feat/x"
    assert gp.apply("git merge feat/x", dict(PREFS, merge_method="rebase")) == "git merge --ff-only feat/x"
    assert gp.apply("git merge --abort", PREFS) == "git merge --abort"


def test_pull_requests_follow_draft_and_merge_settings():
    assert gp.apply('gh pr create --title "Login" --body "x"', PREFS) == \
        'gh pr create --title Login --body x --draft'
    assert "--draft" not in gp.apply("gh pr create --fill", dict(PREFS, draft_prs=False))
    assert gp.apply("gh pr merge 12 --merge", PREFS) == "gh pr merge 12 --squash"


def test_preferences_are_validated_and_saved(tmp_path, monkeypatch):
    monkeypatch.setattr(gp.settings, "DATA_DIR", str(tmp_path))
    assert gp.load() == gp.DEFAULTS
    saved = gp.save({"branch_prefix": "smaran/", "merge_method": "rebase", "draft_prs": True})
    assert gp.load() == saved == {"branch_prefix": "smaran/", "merge_method": "rebase", "draft_prs": True}
    for bad in ({"branch_prefix": "../x"}, {"branch_prefix": "a b"}, {"merge_method": "octopus"}):
        with pytest.raises(ValueError):
            gp.save(bad)
    assert "smaran/<short-topic>" in gp.describe() and "drafts" in gp.describe()


def test_run_command_applies_the_rules(tmp_path, monkeypatch):
    from app.agent import tools

    class WS:
        root = tmp_path

    monkeypatch.setattr(gp, "load", lambda: PREFS)
    assert tools.run_command(WS(), "git push --force").startswith("Refused: Force-pushing is blocked")
    assert tools.git(WS(), "reset --hard").startswith("Refused:")
