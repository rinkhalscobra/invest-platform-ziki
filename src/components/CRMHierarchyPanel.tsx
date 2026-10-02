import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
  Users
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export type CRMRole = 'admin' | 'superior_manager' | 'manager' | 'agent' | 'client';

interface HierarchyUser {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  crm_role: CRMRole;
  crm_parent_id?: string | null;
  direct_reports?: number;
  branch_size?: number;
}

interface CRMContext {
  actor_id: string;
  actor_role: CRMRole;
  actor_name: string;
  can_manage_hierarchy: boolean;
  has_workspace_access: boolean;
}

interface HierarchyPayload {
  users?: HierarchyUser[];
  role_counts?: Partial<Record<CRMRole, number>>;
}

interface CRMHierarchyPanelProps {
  reason: string;
  onOpenWorkspace: (userId: string) => void;
  onHierarchyChanged: () => Promise<void> | void;
}

const roles: CRMRole[] = ['admin', 'superior_manager', 'manager', 'agent', 'client'];

const roleLabels: Record<CRMRole, string> = {
  admin: 'Admin',
  superior_manager: 'Superior Manager',
  manager: 'Manager',
  agent: 'Agent',
  client: 'Client'
};

const roleDescriptions: Record<CRMRole, string> = {
  admin: 'Full access to the entire CRM',
  superior_manager: 'Own managers, agents, and clients',
  manager: 'Own agents and their clients',
  agent: 'Only directly assigned clients',
  client: 'No CRM workspace access'
};

const roleStyles: Record<CRMRole, string> = {
  admin: 'border-sky-400/35 bg-sky-500/10 text-sky-300',
  superior_manager: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300',
  manager: 'border-orange-400/35 bg-orange-500/10 text-orange-300',
  agent: 'border-violet-400/35 bg-violet-500/10 text-violet-300',
  client: 'border-slate-500/35 bg-slate-500/10 text-slate-300'
};

const requiredParentRole: Partial<Record<CRMRole, CRMRole>> = {
  superior_manager: 'admin',
  manager: 'superior_manager',
  agent: 'manager',
  client: 'agent'
};

const displayName = (user: HierarchyUser) => {
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return name || user.email;
};

const CRMHierarchyPanel: React.FC<CRMHierarchyPanelProps> = ({
  reason,
  onOpenWorkspace,
  onHierarchyChanged
}) => {
  const [context, setContext] = useState<CRMContext | null>(null);
  const [users, setUsers] = useState<HierarchyUser[]>([]);
  const [roleCounts, setRoleCounts] = useState<Partial<Record<CRMRole, number>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<CRMRole>('client');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadHierarchy = useCallback(async () => {
    setLoading(true);
    const [contextResult, hierarchyResult] = await Promise.all([
      supabase.rpc('crm_get_context'),
      supabase.rpc('crm_get_hierarchy')
    ]);
    setLoading(false);

    if (contextResult.error || hierarchyResult.error) {
      setStatus({ type: 'error', text: contextResult.error?.message || hierarchyResult.error?.message || 'Unable to load hierarchy' });
      return;
    }

    const nextContext = contextResult.data as CRMContext;
    const payload = (hierarchyResult.data || {}) as HierarchyPayload;
    setContext(nextContext);
    setUsers(payload.users || []);
    setRoleCounts(payload.role_counts || {});
  }, []);

  useEffect(() => {
    void loadHierarchy();
  }, [loadHierarchy]);

  const selectedUser = useMemo(
    () => users.find(user => user.id === selectedId) || null,
    [selectedId, users]
  );

  useEffect(() => {
    if (!selectedUser) return;
    setSelectedRole(selectedUser.crm_role);
    setSelectedParentId(selectedUser.crm_parent_id || '');
  }, [selectedUser]);

  const usersById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, HierarchyUser[]>();
    users.forEach(user => {
      const parentKey = user.crm_parent_id && usersById.has(user.crm_parent_id) ? user.crm_parent_id : 'root';
      map.set(parentKey, [...(map.get(parentKey) || []), user]);
    });
    map.forEach(children => children.sort((a, b) => roles.indexOf(a.crm_role) - roles.indexOf(b.crm_role) || displayName(a).localeCompare(displayName(b))));
    return map;
  }, [users, usersById]);

  const parentCandidates = useMemo(() => {
    const parentRole = requiredParentRole[selectedRole];
    if (!parentRole) return [];
    return users.filter(user => user.crm_role === parentRole && user.id !== selectedId);
  }, [selectedId, selectedRole, users]);

  useEffect(() => {
    if (selectedRole === 'admin') {
      setSelectedParentId('');
      return;
    }
    const parentIsValid = parentCandidates.some(user => user.id === selectedParentId);
    if (!parentIsValid) setSelectedParentId('');
  }, [parentCandidates, selectedParentId, selectedRole]);

  const saveHierarchy = async () => {
    if (!selectedUser || !context?.can_manage_hierarchy) return;
    if (selectedRole !== 'admin' && selectedRole !== 'client' && !selectedParentId) {
      setStatus({ type: 'error', text: `${roleLabels[selectedRole]} requires a ${roleLabels[requiredParentRole[selectedRole] as CRMRole]}.` });
      return;
    }
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.rpc('crm_update_hierarchy', {
      p_target_user_id: selectedUser.id,
      p_role: selectedRole,
      p_parent_user_id: selectedParentId || null,
      p_reason: reason
    });
    setSaving(false);
    if (error) {
      setStatus({ type: 'error', text: error.message });
      return;
    }
    setStatus({ type: 'success', text: `${displayName(selectedUser)} is now assigned as ${roleLabels[selectedRole]}.` });
    await Promise.all([loadHierarchy(), onHierarchyChanged()]);
  };

  const renderNode = (user: HierarchyUser, depth = 0): React.ReactNode => {
    const children = childrenByParent.get(user.id) || [];
    const isCurrentUser = user.id === context?.actor_id;
    return (
      <React.Fragment key={user.id}>
        <div
          className={`group grid min-w-[760px] grid-cols-[minmax(270px,1fr)_190px_130px_150px] items-center gap-3 border-b border-slate-800/80 px-4 py-3 transition hover:bg-white/[0.025] ${selectedId === user.id ? 'bg-purple-500/[0.08]' : ''}`}
        >
          <div className="flex min-w-0 items-center" style={{ paddingLeft: `${Math.min(depth, 4) * 30}px` }}>
            {depth > 0 && <div className="mr-3 h-px w-5 shrink-0 bg-slate-700" />}
            <button
              type="button"
              onClick={() => context?.can_manage_hierarchy && setSelectedId(user.id)}
              className="flex min-w-0 items-center gap-3 text-left"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${roleStyles[user.crm_role]}`}>
                {user.crm_role === 'admin' ? <ShieldCheck size={17} /> : <UserRound size={17} />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">{displayName(user)}</span>
                  {isCurrentUser && <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-purple-300">You</span>}
                </span>
                <span className="block truncate text-xs text-slate-500">{user.email}</span>
              </span>
            </button>
          </div>
          <div><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${roleStyles[user.crm_role]}`}>{roleLabels[user.crm_role]}</span></div>
          <div className="text-sm text-slate-300"><span className="font-semibold text-white">{user.direct_reports || 0}</span> direct</div>
          <div className="flex justify-end">
            {!isCurrentUser && (
              <button type="button" onClick={() => onOpenWorkspace(user.id)} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-purple-500/50 hover:text-white">
                Open CRM <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
        {children.map(child => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center gap-3 rounded-2xl border border-slate-700/70 bg-slate-900/75 text-slate-400"><Loader2 className="animate-spin" size={20} />Loading hierarchy</div>;
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/75 shadow-xl shadow-black/10">
        <div className="flex flex-col gap-4 border-b border-slate-700/70 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-white"><Network className="text-purple-400" size={21} /><h2 className="text-lg font-bold">User hierarchy</h2></div>
            <p className="mt-1 text-sm text-slate-400">Access flows upward through assigned branches and never sideways.</p>
          </div>
          <div className="flex items-center gap-3">
            {context && <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${roleStyles[context.actor_role]}`}>Signed in as {roleLabels[context.actor_role]}</span>}
            <button type="button" onClick={() => void loadHierarchy()} className="rounded-xl border border-slate-700 p-2.5 text-slate-400 hover:border-purple-500/50 hover:text-white" aria-label="Refresh hierarchy"><RefreshCw size={17} /></button>
          </div>
        </div>

        <div className="grid gap-px bg-slate-800 sm:grid-cols-2 xl:grid-cols-5">
          {roles.map(role => (
            <div key={role} className="bg-slate-900/95 p-4">
              <div className="flex items-center justify-between gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${roleStyles[role]}`}>{roleLabels[role]}</span><span className="text-xl font-bold text-white">{roleCounts[role] || 0}</span></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{roleDescriptions[role]}</p>
            </div>
          ))}
        </div>
      </section>

      {status && <div className={`rounded-xl border px-4 py-3 text-sm ${status.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{status.text}</div>}

      <div className={`grid gap-5 ${context?.can_manage_hierarchy ? '2xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
        <section className="overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/75 shadow-xl shadow-black/10">
          <div className="flex items-center justify-between border-b border-slate-700/70 px-5 py-4">
            <div><h3 className="font-semibold text-white">Branch structure</h3><p className="mt-1 text-xs text-slate-500">Indented users report to the nearest user above them.</p></div>
            <div className="flex items-center gap-2 text-xs text-slate-400"><GitBranch size={15} />{users.length} visible users</div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-[minmax(270px,1fr)_190px_130px_150px] gap-3 border-b border-slate-800 bg-slate-950/35 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <span>User and reporting line</span><span>Access role</span><span>Reports</span><span className="text-right">Workspace</span>
            </div>
            {(childrenByParent.get('root') || []).map(user => renderNode(user))}
          </div>
        </section>

        {context?.can_manage_hierarchy && (
          <aside className="h-fit rounded-2xl border border-slate-700/70 bg-slate-900/75 p-5 shadow-xl shadow-black/10 2xl:sticky 2xl:top-4">
            <div className="flex items-center gap-2"><Users size={19} className="text-purple-400" /><h3 className="font-semibold text-white">Assign access</h3></div>
            {!selectedUser ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-700 px-5 py-10 text-center text-sm text-slate-500">Select any user in the hierarchy to change their role or reporting line.</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                  <div className="truncate text-sm font-semibold text-white">{displayName(selectedUser)}</div>
                  <div className="truncate text-xs text-slate-500">{selectedUser.email}</div>
                </div>
                <label className="block text-xs text-slate-400">CRM role
                  <select value={selectedRole} onChange={event => setSelectedRole(event.target.value as CRMRole)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500">
                    {roles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}
                  </select>
                </label>
                {selectedRole !== 'admin' && (
                  <label className="block text-xs text-slate-400">Reports to {requiredParentRole[selectedRole] ? `(${roleLabels[requiredParentRole[selectedRole] as CRMRole]})` : ''}
                    <select value={selectedParentId} onChange={event => setSelectedParentId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500">
                      {selectedRole === 'client' && <option value="">Unassigned client</option>}
                      {selectedRole !== 'client' && <option value="">Select reporting manager</option>}
                      {parentCandidates.map(user => <option key={user.id} value={user.id}>{displayName(user)} — {user.email}</option>)}
                    </select>
                  </label>
                )}
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/[0.07] p-3 text-xs leading-5 text-purple-200/80">{roleDescriptions[selectedRole]}. Parallel branches remain isolated.</div>
                <button type="button" onClick={() => void saveHierarchy()} disabled={saving || !reason.trim() || (selectedRole !== 'admin' && selectedRole !== 'client' && !selectedParentId)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-40">
                  {saving ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />}Save hierarchy assignment
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};

export default CRMHierarchyPanel;
