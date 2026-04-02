import type { CompetitionSummary, PublicUser, Role } from "./domain.js";

export type PermissionUser = Pick<PublicUser, "id" | "roles" | "emailVerified">;

export function hasRole(user: PermissionUser | null | undefined, role: Role): boolean {
  return !!user?.roles.includes(role);
}

export function isAdmin(user: PermissionUser | null | undefined): boolean {
  return hasRole(user, "admin");
}

export function canCreateCompetition(user: PermissionUser | null | undefined): boolean {
  return !!user && user.emailVerified;
}

export function canManageCompetition(
  user: PermissionUser | null | undefined,
  competition: Pick<CompetitionSummary, "organizerUserId">,
): boolean {
  if (!user) {
    return false;
  }

  return isAdmin(user) || user.id === competition.organizerUserId;
}

export function canManageTours(user: PermissionUser | null | undefined): boolean {
  return isAdmin(user);
}

export function canManageAnnouncements(user: PermissionUser | null | undefined): boolean {
  return isAdmin(user);
}

export function canManageUsers(user: PermissionUser | null | undefined): boolean {
  return isAdmin(user);
}
