import { api } from './client';

// SHARE-ALBUM-01: live album sharing between authenticated NubArca users.
//
// Two families, mirroring the backend:
//   * /api/albums/{id}/members...  the OWNER managing who the album is shared
//     with.
//   * /api/shared-albums/...       the RECIPIENT's view of albums shared with
//     them, and their invitations.
//
// The recipient's media URLs are album-scoped and arrive ready-built from the
// server (`thumbnailUrl`, `previewUrl`, …). They carry no token and no
// signature: they are routes that are re-authorized on every request, so they
// are safe in an <img src> and useless to anybody without their own accepted
// membership. Never construct one by hand from a file id.

export type AlbumRole = 'viewer' | 'contributor' | 'editor';

export type AlbumMembershipState = 'pending' | 'accepted' | 'declined' | 'revoked';

// One row of the owner's member list. Identifies the person by DISPLAY NAME
// only — the API never returns another user's email address or user id, and
// `membershipId` is what addresses the row.
export interface AlbumMember {
  membershipId: string;
  displayName: string;
  // Masked account address ("m•••i@nubarca.local"), owner-only. Display names
  // are NOT unique, so without this an owner with two members called the same
  // thing cannot tell which one to revoke. Empty string when the stored address
  // is unusable. Never present in any recipient-facing shape.
  maskedEmail: string;
  role: AlbumRole;
  state: AlbumMembershipState;
  allowOriginalDownload: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  revokedAt: string | null;
}

export interface ResolvedAlbumRecipient {
  displayName: string;
}

export interface SharedAlbumCoverItem {
  fileItemId: string;
  kind: 'image' | 'video';
  thumbnailUrl: string;
}

export interface SharedAlbumSummary {
  albumId: string;
  name: string;
  description: string | null;
  ownerDisplayName: string;
  role: AlbumRole;
  allowOriginalDownload: boolean;
  itemCount: number;
  sharedAt: string;
  coverItems: SharedAlbumCoverItem[];
}

export interface SharedAlbumDetail {
  albumId: string;
  name: string;
  description: string | null;
  ownerDisplayName: string;
  role: AlbumRole;
  allowOriginalDownload: boolean;
  itemCount: number;
}

// One media item of a shared album. Deliberately carries NO file name: a
// filename is owner-authored free text that can hold a person's name, and the
// viewer does not need it. `downloadUrl` is null unless the membership permits
// originals — and the endpoint enforces the same rule, so hiding the control is
// a courtesy, not the control.
export interface SharedAlbumItem {
  fileItemId: string;
  kind: 'image' | 'video';
  thumbnailUrl: string;
  previewUrl: string;
  posterUrl: string | null;
  videoUrl: string | null;
  downloadUrl: string | null;
  width: number | null;
  height: number | null;
  addedAt: string;
}

export interface AlbumInvitation {
  membershipId: string;
  albumId: string;
  albumName: string;
  albumDescription: string | null;
  ownerDisplayName: string;
  role: AlbumRole;
  allowOriginalDownload: boolean;
  itemCount: number;
  invitedAt: string;
}

// ── Owner side ──────────────────────────────────────────────────────────────

export async function listAlbumMembers(
  albumId: string,
  signal?: AbortSignal,
): Promise<AlbumMember[]> {
  return api<AlbumMember[]>(`/api/albums/${albumId}/members`, { signal });
}

// Confirms an exact email belongs to an invitable account, returning only the
// display name so the owner can check they have the right person before
// sending. POST, not GET: the address must never land in a URL, a server access
// log, browser history, or a Referer header. A 404 means "cannot be invited"
// and covers unknown / disabled / self indistinguishably.
export async function resolveAlbumRecipient(
  albumId: string,
  email: string,
  signal?: AbortSignal,
): Promise<ResolvedAlbumRecipient> {
  return api<ResolvedAlbumRecipient>(`/api/albums/${albumId}/members/resolve`, {
    method: 'POST',
    json: { email },
    signal,
  });
}

export async function inviteAlbumMember(
  albumId: string,
  email: string,
  options?: { role?: AlbumRole; allowOriginalDownload?: boolean },
  signal?: AbortSignal,
): Promise<AlbumMember> {
  return api<AlbumMember>(`/api/albums/${albumId}/members`, {
    method: 'POST',
    json: {
      email,
      role: options?.role ?? 'viewer',
      allowOriginalDownload: options?.allowOriginalDownload ?? false,
    },
    signal,
  });
}

export async function setAlbumMemberDownload(
  albumId: string,
  membershipId: string,
  allowOriginalDownload: boolean,
  signal?: AbortSignal,
): Promise<AlbumMember> {
  return api<AlbumMember>(`/api/albums/${albumId}/members/${membershipId}`, {
    method: 'PATCH',
    json: { allowOriginalDownload },
    signal,
  });
}

// Cancels a pending invitation OR revokes an accepted membership — one call,
// because both mean the same thing to the person on the other end. Takes effect
// on that person's very next request; nothing is cached.
export async function revokeAlbumMember(
  albumId: string,
  membershipId: string,
  signal?: AbortSignal,
): Promise<void> {
  await api<void>(`/api/albums/${albumId}/members/${membershipId}`, {
    method: 'DELETE',
    signal,
  });
}

// ── Recipient side ──────────────────────────────────────────────────────────

export async function listSharedAlbums(signal?: AbortSignal): Promise<SharedAlbumSummary[]> {
  return api<SharedAlbumSummary[]>('/api/shared-albums', { signal });
}

export async function getSharedAlbum(
  albumId: string,
  signal?: AbortSignal,
): Promise<SharedAlbumDetail> {
  return api<SharedAlbumDetail>(`/api/shared-albums/${albumId}`, { signal });
}

export async function listSharedAlbumItems(
  albumId: string,
  signal?: AbortSignal,
): Promise<SharedAlbumItem[]> {
  return api<SharedAlbumItem[]>(`/api/shared-albums/${albumId}/items`, { signal });
}

export async function listAlbumInvitations(signal?: AbortSignal): Promise<AlbumInvitation[]> {
  return api<AlbumInvitation[]>('/api/shared-albums/invitations', { signal });
}

export async function acceptAlbumInvitation(
  membershipId: string,
  signal?: AbortSignal,
): Promise<void> {
  await api<void>(`/api/shared-albums/invitations/${membershipId}/accept`, {
    method: 'POST',
    signal,
  });
}

export async function declineAlbumInvitation(
  membershipId: string,
  signal?: AbortSignal,
): Promise<void> {
  await api<void>(`/api/shared-albums/invitations/${membershipId}/decline`, {
    method: 'POST',
    signal,
  });
}
