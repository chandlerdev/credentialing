import type { Role } from "@/types";

export type CounterKey = "openTasks" | "unreadNotifications" | "outstandingInvoices" | "unreadChat";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: CounterKey;
  dot?: boolean;
  /** Roles that see the item (default: all staff roles). */
  roles?: Role[];
}

const STAFF: Role[] = ["platform_admin", "org_admin", "clerk", "auditor"];
const ADMINS: Role[] = ["platform_admin", "org_admin"];

// Same order and labels as the prototype sidebar.
export const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/organization", label: "Organization", icon: "Building2" },
  { href: "/providers", label: "Providers", icon: "Users" },
  { href: "/credentialing", label: "Credentialing", icon: "ShieldCheck" },
  { href: "/ai-agents", label: "AI Agents", icon: "Sparkles" },
  { href: "/tasks", label: "Tasks", icon: "CheckSquare", badge: "openTasks" },
  { href: "/reports", label: "Reports", icon: "BarChart3" },
  { href: "/email", label: "Email", icon: "Mail" },
  { href: "/custom-templates", label: "Custom Templates", icon: "Mails", roles: ["org_admin"] },
  { href: "/master-data", label: "Master Data", icon: "ListChecks", roles: ["org_admin"] },
  { href: "/payers", label: "Payers", icon: "CreditCard" },
  { href: "/payer-submissions", label: "Payer Submissions", icon: "Send" },
  { href: "/credential-vault", label: "Credential Vault", icon: "KeyRound" },
  { href: "/users", label: "Users", icon: "UserCog", roles: ["platform_admin", "org_admin", "auditor"] },
  { href: "/enrollments", label: "Enrollments", icon: "ClipboardList" },
  { href: "/locations", label: "Locations", icon: "MapPin" },
  { href: "/assignments", label: "Provider Assignments", icon: "GitBranch" },
  { href: "/permissions", label: "Permissions", icon: "ShieldCheck" },
  { href: "/test-data", label: "Test Data", icon: "Sparkles", roles: ADMINS },
  { href: "/caqh-config", label: "CAQH Config", icon: "Settings" },
  { href: "/secure-links", label: "Secure Links", icon: "Link" },
  { href: "/payer-api-reference", label: "Payer API Reference", icon: "BookOpen" },
  { href: "/folder-sync", label: "Folder Sync", icon: "FolderSync" },
  { href: "/caqh-authorization", label: "CAQH Authorization", icon: "ShieldCheck" },
  { href: "/billing", label: "Billing", icon: "Receipt", badge: "outstandingInvoices", roles: ["platform_admin", "org_admin", "auditor"] },
];

export const SYSTEM_NAV: NavItem[] = [
  { href: "/notifications", label: "Notifications", icon: "Bell", badge: "unreadNotifications" },
  { href: "/chat", label: "Chat", icon: "MessageCircle", badge: "unreadChat" },
  { href: "/payer-applications", label: "Admin", icon: "Shield", dot: true, roles: ADMINS },
];

export const PLATFORM_NAV: NavItem[] = [
  { href: "/platform/organizations", label: "Organizations", icon: "Building", roles: ["platform_admin"] },
];

// Provider portal (prototype's limited provider nav).
export const PROVIDER_NAV: NavItem[] = [
  { href: "/my-portal", label: "My Portal", icon: "User" },
  { href: "/my-documents", label: "My Documents", icon: "FileText" },
  { href: "/my-enrollments", label: "My Enrollments", icon: "ClipboardList" },
  { href: "/my-profile", label: "Manage Profile", icon: "UserCog" },
  { href: "/notifications", label: "Notifications", icon: "Bell", badge: "unreadNotifications" },
];

/** Routes a provider user may open; everything else redirects to /my-portal. */
export const PROVIDER_ROUTES = ["/my-portal", "/my-documents", "/my-enrollments", "/my-profile", "/notifications"];

export const isVisible = (item: NavItem, role: Role) => (item.roles ? item.roles.includes(role) : STAFF.includes(role));

// Super admin (platform_admin): only these three modules.
export const SUPER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ["platform_admin"] },
  { href: "/create-admin", label: "Create Admin", icon: "UserPlus", roles: ["platform_admin"] },
  { href: "/user-roles", label: "User Roles", icon: "BadgeCheck", roles: ["platform_admin"] },
  { href: "/organizations", label: "Organizations", icon: "Building2", roles: ["platform_admin"] },
  { href: "/all-providers", label: "Providers", icon: "Users", roles: ["platform_admin"] },
  { href: "/all-payers", label: "Payers", icon: "CreditCard", roles: ["platform_admin"] },
  { href: "/master-data", label: "Master Data", icon: "ListChecks", roles: ["platform_admin"] },
  { href: "/communication", label: "Communication", icon: "PhoneCall", roles: ["platform_admin"] },
];

/** Routes the super admin may open; everything else redirects to /dashboard. */
export const SUPER_ROUTES = ["/dashboard", "/create-admin", "/user-roles", "/organizations", "/all-providers", "/all-payers", "/master-data", "/communication"];
