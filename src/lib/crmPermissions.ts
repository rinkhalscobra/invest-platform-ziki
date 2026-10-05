export type CRMRole = 'admin' | 'retention' | 'manager' | 'agent' | 'client';

export type CRMPermission =
  | 'crm.view'
  | 'customers.manage'
  | 'wallet.manage'
  | 'trading.manage'
  | 'robot.manage'
  | 'deposits.review'
  | 'support.manage'
  | 'notifications.send'
  | 'audit.view'
  | 'hierarchy.manage'
  | 'users.manage';

export const crmRoles: CRMRole[] = ['admin', 'retention', 'manager', 'agent', 'client'];

export const crmRoleLabels: Record<CRMRole, string> = {
  admin: 'Admin',
  retention: 'Retention',
  manager: 'Manager',
  agent: 'Agent',
  client: 'Client'
};

export const crmPermissionOptions: Array<{ key: CRMPermission; label: string; description: string }> = [
  { key: 'crm.view', label: 'CRM access', description: 'Open the CRM and view assigned customers.' },
  { key: 'customers.manage', label: 'Customer profiles', description: 'Edit customer identity, KYC, notes and account settings.' },
  { key: 'wallet.manage', label: 'Wallets and balances', description: 'View and manage balances, assets and wallet transactions.' },
  { key: 'trading.manage', label: 'Trading activity', description: 'Manage trading, staking, events, referrals and challenge records.' },
  { key: 'robot.manage', label: 'Robot controls', description: 'Manage robot settings and credit robot profits.' },
  { key: 'deposits.review', label: 'Payment reviews', description: 'Approve or reject deposits and withdrawals.' },
  { key: 'support.manage', label: 'Customer support', description: 'Read conversations and send support replies.' },
  { key: 'notifications.send', label: 'Notifications', description: 'Send account notifications to assigned customers.' },
  { key: 'audit.view', label: 'Audit history', description: 'View administrator action logs.' },
  { key: 'hierarchy.manage', label: 'Hierarchy management', description: 'Change roles, permissions and reporting lines.' },
  { key: 'users.manage', label: 'User management', description: 'Create users and manage Supabase Auth credentials.' }
];

const enabled = (...keys: CRMPermission[]): Record<CRMPermission, boolean> => Object.fromEntries(
  crmPermissionOptions.map(option => [option.key, keys.includes(option.key)])
) as Record<CRMPermission, boolean>;

export const crmRolePermissionPresets: Record<CRMRole, Record<CRMPermission, boolean>> = {
  admin: enabled(...crmPermissionOptions.map(option => option.key)),
  retention: enabled('crm.view', 'customers.manage', 'wallet.manage', 'trading.manage', 'robot.manage', 'deposits.review', 'support.manage', 'notifications.send', 'audit.view'),
  manager: enabled('crm.view', 'customers.manage', 'wallet.manage', 'trading.manage', 'robot.manage', 'deposits.review', 'support.manage', 'notifications.send'),
  agent: enabled('crm.view', 'customers.manage', 'wallet.manage', 'trading.manage', 'support.manage', 'notifications.send'),
  client: enabled()
};

export const permissionsForRole = (role: CRMRole) => ({ ...crmRolePermissionPresets[role] });
