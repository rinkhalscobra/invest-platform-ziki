import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UserCog,
  UserPlus,
  UserRound,
  Users
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import {
  CRMPermission,
  CRMRole,
  crmPermissionOptions,
  crmRoleLabels,
  crmRoles,
  permissionsForRole
} from '../lib/crmPermissions';

export type { CRMRole } from '../lib/crmPermissions';

interface HierarchyUser {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  crm_role: CRMRole;
  crm_parent_id?: string | null;
  crm_permissions?: Partial<Record<CRMPermission, boolean>> | null;
  direct_reports?: number;
  branch_size?: number;
}

interface CRMContext {
  actor_id: string;
  actor_role: CRMRole;
  actor_name: string;
  can_manage_hierarchy: boolean;
  can_manage_users: boolean;
  has_workspace_access: boolean;
  permissions: Record<CRMPermission, boolean>;
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

const roleDescriptions: Record<CRMRole, string> = {
  admin: 'Full access to the entire CRM',
  retention: 'Own managers, agents, clients, payments, and retention tools',
  manager: 'Own agents and their assigned clients',
  agent: 'Only directly assigned clients',
  client: 'No CRM workspace access'
};

const roleStyles: Record<CRMRole, string> = {
  admin: 'border-sky-400/35 bg-sky-500/10 text-sky-300',
  retention: 'border-pink-400/35 bg-pink-500/10 text-pink-300',
  manager: 'border-orange-400/35 bg-orange-500/10 text-orange-300',
  agent: 'border-violet-400/35 bg-violet-500/10 text-violet-300',
  client: 'border-slate-500/35 bg-slate-500/10 text-slate-300'
};

const roleRank = (role: CRMRole) => crmRoles.indexOf(role);

const allowedParentRoles = (role: CRMRole): CRMRole[] => (
  role === 'admin' ? [] : crmRoles.filter(candidate => roleRank(candidate) < roleRank(role))
);

const emptyCreateForm = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  role: 'client' as CRMRole,
  parentId: ''
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
  const [selectedPermissions, setSelectedPermissions] = useState(permissionsForRole('client'));
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createPermissions, setCreatePermissions] = useState(permissionsForRole('client'));
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | CRMRole>('all');
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
    setSelectedId(current => {
      if (current && (payload.users || []).some(user => user.id === current)) return current;
      if (!nextContext?.can_manage_hierarchy) return null;
      return (payload.users || []).find(user => user.id !== nextContext.actor_id)?.id || null;
    });
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
    setSelectedPermissions({
      ...permissionsForRole(selectedUser.crm_role),
      ...(selectedUser.crm_permissions || {})
    });
  }, [selectedUser]);

  const usersById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, HierarchyUser[]>();
    users.forEach(user => {
      const parentKey = user.crm_parent_id && usersById.has(user.crm_parent_id) ? user.crm_parent_id : 'root';
      map.set(parentKey, [...(map.get(parentKey) || []), user]);
    });
    map.forEach(children => children.sort((a, b) => crmRoles.indexOf(a.crm_role) - crmRoles.indexOf(b.crm_role) || displayName(a).localeCompare(displayName(b))));
    return map;
  }, [users, usersById]);

  const parentCandidates = useMemo(() => {
    const parentRoles = allowedParentRoles(selectedRole);
    return users.filter(user => parentRoles.includes(user.crm_role) && user.id !== selectedId);
  }, [selectedId, selectedRole, users]);

  const createParentCandidates = useMemo(() => {
    const parentRoles = allowedParentRoles(createForm.role);
    return users.filter(user => parentRoles.includes(user.crm_role));
  }, [createForm.role, users]);

  const selectedDirectReports = useMemo(
    () => selectedId ? users.filter(user => user.crm_parent_id === selectedId) : [],
    [selectedId, users]
  );

  const incompatibleDirectReports = useMemo(
    () => selectedDirectReports.filter(user => roleRank(user.crm_role) <= roleRank(selectedRole)),
    [selectedDirectReports, selectedRole]
  );

  const visibleUserIds = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch && roleFilter === 'all') return null;
    const visible = new Set<string>();
    users.forEach(user => {
      const matchesSearch = !normalizedSearch || `${displayName(user)} ${user.email}`.toLowerCase().includes(normalizedSearch);
      const matchesRole = roleFilter === 'all' || user.crm_role === roleFilter;
      if (!matchesSearch || !matchesRole) return;
      let current: HierarchyUser | undefined = user;
      while (current && !visible.has(current.id)) {
        visible.add(current.id);
        current = current.crm_parent_id ? usersById.get(current.crm_parent_id) : undefined;
      }
    });
    return visible;
  }, [roleFilter, search, users, usersById]);

  useEffect(() => {
    if (selectedRole === 'admin') {
      setSelectedParentId('');
      return;
    }
    const parentIsValid = parentCandidates.some(user => user.id === selectedParentId);
    if (!parentIsValid) setSelectedParentId('');
  }, [parentCandidates, selectedParentId, selectedRole]);

  useEffect(() => {
    if (createForm.role === 'admin') {
      setCreateForm(current => ({ ...current, parentId: '' }));
      return;
    }
    if (createForm.parentId && !createParentCandidates.some(user => user.id === createForm.parentId)) {
      setCreateForm(current => ({ ...current, parentId: '' }));
    }
  }, [createForm.parentId, createForm.role, createParentCandidates]);

  const changeSelectedRole = (role: CRMRole) => {
    setSelectedRole(role);
    setSelectedPermissions(permissionsForRole(role));
  };

  const selectUser = (user: HierarchyUser) => {
    setSelectedId(user.id);
    setSelectedRole(user.crm_role);
    setSelectedParentId(user.crm_parent_id || '');
    setSelectedPermissions({
      ...permissionsForRole(user.crm_role),
      ...(user.crm_permissions || {})
    });
  };

  const changeCreateRole = (role: CRMRole) => {
    setCreateForm(current => ({ ...current, role, parentId: '' }));
    setCreatePermissions(permissionsForRole(role));
  };

  const saveHierarchy = async () => {
    if (!selectedUser || !context?.can_manage_hierarchy) return;
    if (selectedRole !== 'admin' && selectedRole !== 'client' && !selectedParentId) {
      const required = allowedParentRoles(selectedRole).map(role => crmRoleLabels[role]).join(', ');
      setStatus({ type: 'error', text: `${crmRoleLabels[selectedRole]} requires a ${required}.` });
      return;
    }
    if (incompatibleDirectReports.length > 0) {
      setStatus({ type: 'error', text: `Reassign ${incompatibleDirectReports.length} incompatible direct report${incompatibleDirectReports.length === 1 ? '' : 's'} before changing this role.` });
      return;
    }
    setSaving(true);
    setStatus(null);
    const { error } = await supabase.rpc('crm_update_user_access', {
      p_target_user_id: selectedUser.id,
      p_role: selectedRole,
      p_parent_user_id: selectedParentId || null,
      p_permissions: selectedPermissions,
      p_reason: reason
    });
    setSaving(false);
    if (error) {
      setStatus({ type: 'error', text: error.message });
      return;
    }
    setStatus({ type: 'success', text: `${displayName(selectedUser)} is now assigned as ${crmRoleLabels[selectedRole]}.` });
    await Promise.all([loadHierarchy(), onHierarchyChanged()]);
  };

  const invokeUserManagement = async (body: Record<string, unknown>) => {
    const { data: sessionResult } = await supabase.auth.getSession();
    if (!sessionResult.session) throw new Error('Administrator session expired. Sign in again.');

    const call = (accessToken: string) => supabase.functions.invoke('admin-user-management', {
      body,
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    let result = await call(sessionResult.session.access_token);
    const firstResponse = (result.error as { context?: Response } | null)?.context;
    if (firstResponse instanceof Response && firstResponse.status === 401) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session) throw new Error('Administrator session expired. Sign in again.');
      result = await call(refreshed.session.access_token);
    }
    if (result.error) {
      let detail = result.error.message;
      const response = (result.error as { context?: Response }).context;
      if (response instanceof Response) {
        try {
          const payload = await response.clone().json() as { error?: string };
          detail = payload.error || detail;
        } catch {
          // Keep the SDK error when the response is not JSON.
        }
      }
      throw new Error(detail);
    }
    const payload = result.data as { error?: string } | null;
    if (payload?.error) throw new Error(payload.error);
  };

  const createUser = async () => {
    if (!context?.can_manage_users) return;
    if (!reason.trim()) {
      setStatus({ type: 'error', text: 'Enter an audit reason before creating a user.' });
      return;
    }
    if (!createForm.firstName.trim() || !createForm.lastName.trim() || !createForm.email.trim()) {
      setStatus({ type: 'error', text: 'First name, last name and email are required.' });
      return;
    }
    if (createForm.password.length < 8) {
      setStatus({ type: 'error', text: 'The temporary password must contain at least 8 characters.' });
      return;
    }
    if (createForm.role !== 'admin' && createForm.role !== 'client' && !createForm.parentId) {
      setStatus({ type: 'error', text: `${crmRoleLabels[createForm.role]} requires a reporting manager.` });
      return;
    }

    setCreating(true);
    setStatus(null);
    try {
      await invokeUserManagement({
        action: 'create_user',
        email: createForm.email,
        password: createForm.password,
        first_name: createForm.firstName,
        last_name: createForm.lastName,
        role: createForm.role,
        parent_user_id: createForm.parentId || null,
        permissions: createPermissions,
        reason
      });
      setStatus({ type: 'success', text: `${createForm.email.trim().toLowerCase()} was created as ${crmRoleLabels[createForm.role]}.` });
      setCreateForm(emptyCreateForm);
      setCreatePermissions(permissionsForRole('client'));
      await Promise.all([loadHierarchy(), onHierarchyChanged()]);
    } catch (error) {
      setStatus({ type: 'error', text: error instanceof Error ? error.message : 'Could not create the user.' });
    } finally {
      setCreating(false);
    }
  };

  const renderNode = (user: HierarchyUser, depth = 0): React.ReactNode => {
    const children = childrenByParent.get(user.id) || [];
    const isCurrentUser = user.id === context?.actor_id;
    if (visibleUserIds && !visibleUserIds.has(user.id)) return null;
    return (
      <React.Fragment key={user.id}>
        <div
          className={`group grid min-w-[900px] grid-cols-[minmax(300px,1fr)_150px_115px_260px] items-center gap-3 border-b border-slate-800/80 px-4 py-3 transition hover:bg-white/[0.025] ${selectedId === user.id ? 'bg-purple-500/[0.08]' : ''}`}
        >
          <div className="flex min-w-0 items-center" style={{ paddingLeft: `${Math.min(depth, 4) * 30}px` }}>
            {depth > 0 && <div className="mr-3 h-px w-5 shrink-0 bg-slate-700" />}
            <div className="flex min-w-0 items-center gap-3 text-left">
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
            </div>
          </div>
          <div><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${roleStyles[user.crm_role]}`}>{crmRoleLabels[user.crm_role]}</span></div>
          <div className="text-sm text-slate-300"><span className="font-semibold text-white">{user.direct_reports || 0}</span> direct</div>
          <div className="flex justify-end gap-2">
            {context?.can_manage_hierarchy && !isCurrentUser && (
              <button type="button" onClick={() => selectUser(user)} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${selectedId === user.id ? 'border-purple-400 bg-purple-500/15 text-purple-200' : 'border-slate-700 text-slate-300 hover:border-purple-500/50 hover:text-white'}`}>
                <UserCog size={14} />{selectedId === user.id ? 'Selected' : 'Manage'}
              </button>
            )}
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
            <p className="mt-1 text-sm text-slate-400">Assign each user to any higher-level role. Levels may be skipped when your structure requires it.</p>
          </div>
          <div className="flex items-center gap-3">
            {context && <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${roleStyles[context.actor_role]}`}>Signed in as {crmRoleLabels[context.actor_role]}</span>}
            <button type="button" onClick={() => void loadHierarchy()} className="rounded-xl border border-slate-700 p-2.5 text-slate-400 hover:border-purple-500/50 hover:text-white" aria-label="Refresh hierarchy"><RefreshCw size={17} /></button>
          </div>
        </div>

        <div className="grid gap-px bg-slate-800 sm:grid-cols-2 xl:grid-cols-5">
          {crmRoles.map(role => (
            <div key={role} className="bg-slate-900/95 p-4">
              <div className="flex items-center justify-between gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${roleStyles[role]}`}>{crmRoleLabels[role]}</span><span className="text-xl font-bold text-white">{roleCounts[role] || 0}</span></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{roleDescriptions[role]}</p>
            </div>
          ))}
        </div>
      </section>

      {status && <div className={`rounded-xl border px-4 py-3 text-sm ${status.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>{status.text}</div>}

      {context?.can_manage_users && (
        <section className="rounded-2xl border border-slate-700/70 bg-slate-900/75 p-5 shadow-xl shadow-black/10">
          <div className="flex items-center gap-2 text-white"><UserPlus className="text-emerald-400" size={21} /><h3 className="font-semibold">Create CRM user</h3></div>
          <p className="mt-1 text-xs text-slate-500">Creates a confirmed Supabase Auth account, initializes the customer profile, and applies the selected CRM permissions.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs text-slate-400">First name<input value={createForm.firstName} onChange={event => setCreateForm(current => ({ ...current, firstName: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500" /></label>
            <label className="text-xs text-slate-400">Last name<input value={createForm.lastName} onChange={event => setCreateForm(current => ({ ...current, lastName: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500" /></label>
            <label className="text-xs text-slate-400">Email<input type="email" value={createForm.email} onChange={event => setCreateForm(current => ({ ...current, email: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500" /></label>
            <label className="text-xs text-slate-400">Temporary password<input type="password" minLength={8} value={createForm.password} onChange={event => setCreateForm(current => ({ ...current, password: event.target.value }))} placeholder="At least 8 characters" className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500" /></label>
            <label className="text-xs text-slate-400">Role
              <select value={createForm.role} onChange={event => changeCreateRole(event.target.value as CRMRole)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500">
                {crmRoles.map(role => <option key={role} value={role}>{crmRoleLabels[role]}</option>)}
              </select>
            </label>
            {createForm.role !== 'admin' && (
              <label className="text-xs text-slate-400">Reports to
                <select value={createForm.parentId} onChange={event => setCreateForm(current => ({ ...current, parentId: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500">
                  {createForm.role === 'client' && <option value="">Unassigned client</option>}
                  {createForm.role !== 'client' && <option value="">Select reporting manager</option>}
                  {allowedParentRoles(createForm.role).map(role => {
                    const candidates = createParentCandidates.filter(user => user.crm_role === role);
                    return candidates.length > 0 ? <optgroup key={role} label={crmRoleLabels[role]}>{candidates.map(user => <option key={user.id} value={user.id}>{displayName(user)} — {user.email}</option>)}</optgroup> : null;
                  })}
                </select>
              </label>
            )}
          </div>
          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Permissions</div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {crmPermissionOptions.map(permission => (
                <label key={permission.key} className={`flex items-start gap-3 rounded-xl border p-3 ${createPermissions[permission.key] ? 'border-purple-500/35 bg-purple-500/[0.08]' : 'border-slate-700 bg-slate-950/30'} ${createForm.role === 'admin' ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={createPermissions[permission.key]} disabled={createForm.role === 'admin'} onChange={event => setCreatePermissions(current => ({ ...current, [permission.key]: event.target.checked }))} className="mt-0.5" />
                  <span><span className="block text-sm font-medium text-white">{permission.label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{permission.description}</span></span>
                </label>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => void createUser()} disabled={creating || !reason.trim()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
            {creating ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}Create user
          </button>
        </section>
      )}

      <div className={`grid gap-5 ${context?.can_manage_hierarchy ? '2xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
        <section className="overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/75 shadow-xl shadow-black/10">
          <div className="border-b border-slate-700/70 px-5 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div><h3 className="font-semibold text-white">Branch structure</h3><p className="mt-1 text-xs text-slate-500">Indented users report to the nearest user above them. Use Manage to edit any account.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="relative min-w-[230px]"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name or email" className="w-full rounded-lg border border-slate-700 bg-slate-950/60 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-purple-500" /></label>
                <select value={roleFilter} onChange={event => setRoleFilter(event.target.value as 'all' | CRMRole)} className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-white outline-none focus:border-purple-500"><option value="all">All roles</option>{crmRoles.map(role => <option key={role} value={role}>{crmRoleLabels[role]}</option>)}</select>
                <div className="flex items-center justify-center gap-2 whitespace-nowrap text-xs text-slate-400"><GitBranch size={15} />{visibleUserIds ? visibleUserIds.size : users.length} visible</div>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[900px] grid-cols-[minmax(300px,1fr)_150px_115px_260px] gap-3 border-b border-slate-800 bg-slate-950/35 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <span>User and reporting line</span><span>Access role</span><span>Reports</span><span className="text-right">Actions</span>
            </div>
            {(childrenByParent.get('root') || []).map(user => renderNode(user))}
            {visibleUserIds?.size === 0 && <div className="px-5 py-10 text-center text-sm text-slate-500">No users match this search and role filter.</div>}
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
                  <select value={selectedRole} onChange={event => changeSelectedRole(event.target.value as CRMRole)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500">
                    {crmRoles.map(role => <option key={role} value={role}>{crmRoleLabels[role]}</option>)}
                  </select>
                </label>
                {selectedRole !== 'admin' && (
                  <label className="block text-xs text-slate-400">Reports to <span className="text-slate-600">({allowedParentRoles(selectedRole).map(role => crmRoleLabels[role]).join(', ')})</span>
                    <select value={selectedParentId} onChange={event => setSelectedParentId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-purple-500">
                      {selectedRole === 'client' && <option value="">Unassigned client</option>}
                      {selectedRole !== 'client' && <option value="">Select reporting manager</option>}
                      {allowedParentRoles(selectedRole).map(role => {
                        const candidates = parentCandidates.filter(user => user.crm_role === role);
                        return candidates.length > 0 ? <optgroup key={role} label={crmRoleLabels[role]}>{candidates.map(user => <option key={user.id} value={user.id}>{displayName(user)} — {user.email}</option>)}</optgroup> : null;
                      })}
                    </select>
                  </label>
                )}
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/[0.07] p-3 text-xs leading-5 text-purple-200/80">{roleDescriptions[selectedRole]}. This user may report to any role above {crmRoleLabels[selectedRole]}; parallel branches remain isolated.</div>
                {incompatibleDirectReports.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">This role would conflict with {incompatibleDirectReports.length} direct report{incompatibleDirectReports.length === 1 ? '' : 's'}: {incompatibleDirectReports.map(displayName).join(', ')}. Reassign those users first.</div>}
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Permissions</div>
                  <div className="space-y-2">
                    {crmPermissionOptions.map(permission => (
                      <label key={permission.key} className={`flex items-start gap-3 rounded-xl border p-3 ${selectedPermissions[permission.key] ? 'border-purple-500/35 bg-purple-500/[0.08]' : 'border-slate-700 bg-slate-950/30'} ${selectedRole === 'admin' ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}>
                        <input type="checkbox" checked={selectedPermissions[permission.key]} disabled={selectedRole === 'admin'} onChange={event => setSelectedPermissions(current => ({ ...current, [permission.key]: event.target.checked }))} className="mt-0.5" />
                        <span><span className="block text-sm font-medium text-white">{permission.label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{permission.description}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => void saveHierarchy()} disabled={saving || !reason.trim() || incompatibleDirectReports.length > 0 || (selectedRole !== 'admin' && selectedRole !== 'client' && !selectedParentId)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-40">
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
