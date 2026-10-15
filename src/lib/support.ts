import { supabase } from '@/lib/supabase';
import { MODULE_CATALOG } from '@/config/permissions';

// ---------------------------------------------------------------------------
// Support Center shared library: types, constants, uploads, RPC wrappers.
// Ticket/company enforcement lives in the database (RLS + RPCs); the UI only
// decides what to show, never what is allowed.
// ---------------------------------------------------------------------------

export const SUPPORT_BUCKET = 'support-files';
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** Demo videos are published by the Super Admin, so they may be larger than a ticket attachment. */
export const DEMO_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const SIGNED_URL_TTL = 3600;

export const TICKET_STATUSES = [
  'Open',
  'In Review',
  'Need Information',
  'In Progress',
  'Resolved',
  'Closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export const TICKET_ISSUE_TYPES = ['Bug', 'Access Issue', 'Calculation Issue', 'Feature Request', 'Other'] as const;

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

export interface SupportTicket {
  id: string;
  company_id: string;
  ticket_no: string;
  subject: string;
  module: string;
  issue_type: string;
  priority: string;
  description: string;
  status: string;
  created_by_user_id: string | null;
  created_by_name: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportComment {
  id: string;
  ticket_id: string;
  body: string;
  is_internal: boolean;
  is_system: boolean;
  author_user_id: string | null;
  author_name: string | null;
  created_at: string;
}

export type AttachmentKind = 'original' | 'annotated' | 'video' | 'file';

export interface SupportAttachment {
  id: string;
  ticket_id: string;
  path: string;
  kind: AttachmentKind;
  mime: string | null;
  size_bytes: number;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface SupportVideo {
  id: string;
  title: string;
  description: string;
  module: string;
  thumbnail_path: string | null;
  video_path: string | null;
  published: boolean;
  published_at: string | null;
  /** true = every company sees it; false = only `company_ids` (loaded with the list for Super Admin). */
  all_companies: boolean;
  company_ids?: string[];
  created_by_name: string | null;
  created_at: string;
}

export interface SupportNotification {
  id: string;
  recipient_user_id: string;
  ticket_id: string | null;
  kind: string;
  text: string;
  is_read: boolean;
  created_at: string;
}

/** ERP modules a ticket can be filed against (key + label from the catalogue). */
export function supportModules(): { key: string; label: string }[] {
  return MODULE_CATALOG.filter((m) => !m.key.startsWith('admin-') && m.key !== 'dashboard' && m.key !== 'reports')
    .map((m) => ({ key: m.key, label: m.label }));
}

export function moduleLabel(key: string): string {
  return MODULE_CATALOG.find((m) => m.key === key)?.label || key || '—';
}

const safeName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+/, '').slice(-120) || 'file';

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

export function classifyFile(file: File): AttachmentKind | null {
  if (IMAGE_MIMES.includes(file.type)) return 'original';
  if (VIDEO_MIMES.includes(file.type)) return 'video';
  return null;
}

export function fileLimitError(file: File): string | null {
  if (IMAGE_MIMES.includes(file.type) && file.size > IMAGE_MAX_BYTES) {
    return `${file.name}: images must be 5 MB or smaller.`;
  }
  if (VIDEO_MIMES.includes(file.type) && file.size > VIDEO_MAX_BYTES) {
    return `${file.name}: videos must be 50 MB or smaller.`;
  }
  if (!IMAGE_MIMES.includes(file.type) && !VIDEO_MIMES.includes(file.type)) {
    return `${file.name}: only images (JPG, PNG, WebP, GIF) and videos (MP4, WebM, MOV) are accepted.`;
  }
  return null;
}

export interface PendingUpload {
  file: File;
  kind: AttachmentKind;
  /** Object URL for local preview before upload. */
  preview: string;
}

/**
 * Upload to the caller's own pending prefix. The create-ticket RPC moves each
 * file into place and rejects anything outside this prefix, so a form field
 * can never attach (or reach) another company's files.
 */
export async function uploadPending(file: File): Promise<{ path: string; size: number; mime: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in again to upload files.');
  const path = `pending/${user.id}/${uid()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(SUPPORT_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
  return { path, size: file.size, mime: file.type };
}

export async function removePending(path: string): Promise<void> {
  await supabase.storage.from(SUPPORT_BUCKET).remove([path]);
}

/** Short-lived view URL (images, annotated copies, video playback). */
export async function supportFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'File unavailable.');
  return data.signedUrl;
}

/** Short-lived download URL that keeps the original filename. */
export async function supportDownloadUrl(path: string, name: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL, { download: name || true });
  if (error || !data?.signedUrl) throw new Error(error?.message || 'File unavailable.');
  return data.signedUrl;
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export const supportApi = {
  createTicket: (input: {
    subject: string; module: string; issue_type: string; priority: string; description: string;
    files: { path: string; kind: AttachmentKind; mime: string; size: number }[];
  }) => rpc<{ id: string; ticket_no: string }>('erp_support_create_ticket', {
    p_subject: input.subject,
    p_module: input.module,
    p_issue_type: input.issue_type,
    p_priority: input.priority,
    p_description: input.description,
    p_files: input.files,
  }),

  /** Tickets visible to the caller (RLS: own, or company-wide for admins). */
  listTickets: async (): Promise<SupportTicket[]> => {
    const { data, error } = await supabase.from('support_tickets')
      .select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as SupportTicket[];
  },

  ticketDetail: async (id: string): Promise<{ ticket: SupportTicket; comments: SupportComment[]; attachments: SupportAttachment[] }> => {
    const [{ data: t, error: tErr }, { data: c, error: cErr }, { data: a, error: aErr }] = await Promise.all([
      supabase.from('support_tickets').select('*').eq('id', id).limit(1),
      supabase.from('support_ticket_comments').select('*').eq('ticket_id', id).order('created_at'),
      supabase.from('support_ticket_attachments').select('*').eq('ticket_id', id).order('created_at'),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (cErr) throw new Error(cErr.message);
    if (aErr) throw new Error(aErr.message);
    if (!t || t.length === 0) throw new Error('Ticket not found or not visible.');
    return { ticket: t[0] as SupportTicket, comments: (c ?? []) as SupportComment[], attachments: (a ?? []) as SupportAttachment[] };
  },

  addComment: (ticketId: string, body: string, internal = false) =>
    rpc<{ id: string }>('erp_support_add_comment', { p_ticket: ticketId, p_body: body, p_internal: internal }),

  setStatus: (ticketId: string, status: string, note = '') =>
    rpc<{ id: string; status: string }>('erp_support_set_status', { p_ticket: ticketId, p_status: status, p_note: note }),

  /** Videos the caller may watch (RLS). Super Admin also gets each video's company list. */
  listVideos: async (publishedOnly: boolean): Promise<SupportVideo[]> => {
    let q = supabase.from('support_demo_videos').select('*').order('created_at', { ascending: false }).limit(200);
    if (publishedOnly) q = q.eq('published', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const videos = (data ?? []) as SupportVideo[];
    if (!publishedOnly && videos.length) {
      const { data: links, error: lErr } = await supabase.from('support_video_companies').select('video_id,company_id').in('video_id', videos.map((v) => v.id));
      if (lErr) throw new Error(lErr.message);
      const byVideo = new Map<string, string[]>();
      for (const l of (links ?? []) as { video_id: string; company_id: string }[]) {
        byVideo.set(l.video_id, [...(byVideo.get(l.video_id) ?? []), l.company_id]);
      }
      for (const v of videos) v.company_ids = byVideo.get(v.id) ?? [];
    }
    return videos;
  },

  /** Create or update a video and replace its company list. Returns the video id. */
  saveVideo: async (v: Partial<SupportVideo> & { id?: string; company_ids?: string[] }): Promise<string> => {
    const payload = {
      title: v.title, description: v.description ?? '', module: v.module ?? '',
      thumbnail_path: v.thumbnail_path ?? null, video_path: v.video_path ?? null,
      published: !!v.published, published_at: v.published ? (v.published_at ?? new Date().toISOString()) : null,
      all_companies: v.all_companies !== false,
      created_by_name: v.created_by_name ?? null,
    };
    let id = v.id;
    if (id) {
      const { error } = await supabase.from('support_demo_videos').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase.from('support_demo_videos').insert(payload).select('id').limit(1);
      if (error) throw new Error(error.message);
      id = (data as { id: string }[] | null)?.[0]?.id;
      if (!id) throw new Error('The video was saved but its id was not returned.');
    }
    const { error: dErr } = await supabase.from('support_video_companies').delete().eq('video_id', id);
    if (dErr) throw new Error(dErr.message);
    const ids = payload.all_companies ? [] : Array.from(new Set(v.company_ids ?? []));
    if (ids.length) {
      const { error: iErr } = await supabase.from('support_video_companies').insert(ids.map((company_id) => ({ video_id: id!, company_id })));
      if (iErr) throw new Error(iErr.message);
    }
    return id;
  },

  /** Super Admin upload into videos/<id>/... (storage policy allows only that prefix). */
  uploadVideoFile: async (file: File | Blob, name: string, folder: string): Promise<string> => {
    const path = `videos/${folder}/${uid()}-${safeName(name)}`;
    const { error } = await supabase.storage.from(SUPPORT_BUCKET).upload(path, file, {
      contentType: (file as File).type || 'application/octet-stream', upsert: false,
    });
    if (error) throw new Error(`Upload failed for ${name}: ${error.message}`);
    return path;
  },

  deleteVideo: async (id: string, paths: string[]): Promise<void> => {
    if (paths.length) await supabase.storage.from(SUPPORT_BUCKET).remove(paths);
    const { error } = await supabase.from('support_demo_videos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  listNotifications: async (): Promise<SupportNotification[]> => {
    const { data, error } = await supabase.from('support_notifications')
      .select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as SupportNotification[];
  },

  markNotificationRead: async (id: string): Promise<void> => {
    const { error } = await supabase.from('support_notifications').update({ is_read: true }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  markAllNotificationsRead: async (): Promise<void> => {
    const { error } = await supabase.from('support_notifications').update({ is_read: true }).eq('is_read', false);
    if (error) throw new Error(error.message);
  },
};
