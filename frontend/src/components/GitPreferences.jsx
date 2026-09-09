import React, { useState } from 'react';

export default function GitPreferences() {
  const [branchPrefix, setBranchPrefix] = useState(() => localStorage.getItem('sm_git_branch_prefix') || 'feat/');
  const [mergeMethod, setMergeMethod] = useState(() => localStorage.getItem('sm_git_merge_method') || 'squash');
  const [draftPR, setDraftPR] = useState(() => localStorage.getItem('sm_git_draft_pr') === 'true');
  const [saveNotice, setSaveNotice] = useState('');

  const updatePrefix = (val) => {
    setBranchPrefix(val);
    localStorage.setItem('sm_git_branch_prefix', val);
    showNotice();
  };

  const updateMerge = (val) => {
    setMergeMethod(val);
    localStorage.setItem('sm_git_merge_method', val);
    showNotice();
  };

  const updateDraft = (val) => {
    setDraftPR(val);
    localStorage.setItem('sm_git_draft_pr', String(val));
    showNotice();
  };

  const showNotice = () => {
    setSaveNotice('Preferences saved.');
    setTimeout(() => setSaveNotice(''), 2000);
  };

  return (
    <section className="space-y-6 text-ink" aria-label="Git preferences">
      <div>
        <h3 className="text-lg font-bold text-ink">Git & Version Control</h3>
        <p className="text-sm text-ink-muted">Configure default branch naming, pull request policies, and safety rules.</p>
      </div>

      {/* Branch Prefix */}
      <div className="border-b border-line pb-4 space-y-2">
        <label htmlFor="sm-branch-prefix" className="text-xs font-bold text-ink block">Default Branch Prefix</label>
        <div className="flex gap-2 max-w-sm">
          <input
            id="sm-branch-prefix"
            type="text"
            value={branchPrefix}
            onChange={e => updatePrefix(e.target.value)}
            className="flex-1 rounded-xl border border-line bg-sunken px-3.5 py-2 text-xs font-mono text-ink outline-none focus:border-indigo-500"
            placeholder="e.g. feat/, fix/, chore/"
          />
        </div>
        <p className="text-[11px] text-ink-faint">Branches created by the agent will automatically use this prefix.</p>
      </div>

      {/* Merge Method Preference */}
      <div className="border-b border-line pb-4 space-y-2">
        <label htmlFor="sm-merge-method" className="text-xs font-bold text-ink block">Preferred Merge Method</label>
        <select
          id="sm-merge-method"
          value={mergeMethod}
          onChange={e => updateMerge(e.target.value)}
          className="w-full max-w-sm rounded-xl border border-line bg-sunken p-2.5 text-xs text-ink outline-none focus:border-indigo-500"
        >
          <option value="squash">Squash and merge (single clean commit)</option>
          <option value="merge">Create a merge commit (preserve individual commits)</option>
          <option value="rebase">Rebase and merge (linear history without merge commit)</option>
        </select>
      </div>

      {/* Draft PR Toggle */}
      <div className="border-b border-line pb-4">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-xs font-bold text-ink">Create Pull Requests as Drafts</div>
            <div className="text-[11px] text-ink-muted">Ensures proposed changes undergo human review before triggering automated CI pipelines.</div>
          </div>
          <input
            type="checkbox"
            checked={draftPR}
            onChange={e => updateDraft(e.target.checked)}
            className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
          />
        </label>
      </div>

      {/* Safety Policy Notice */}
      <div className="rounded-2xl border border-line bg-sunken p-4 space-y-2">
        <div className="text-xs font-bold text-ink flex items-center gap-2">
          <span>Safe Git Enforcement</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-400">Enforced</span>
        </div>
        <p className="text-xs text-ink-muted leading-relaxed">
          SMARAN strictly forbids automated force-pushes (`git push --force`) and destructive history rewrites on user workspaces without explicit authorization.
        </p>
      </div>

      {saveNotice && <p className="text-xs text-indigo-400">{saveNotice}</p>}
    </section>
  );
}
