import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Plus, Pencil, Trash2, Eye, EyeOff, Search, Film } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import {
  supportApi, supportFileUrl, supportModules, moduleLabel,
  DEMO_VIDEO_MAX_BYTES, VIDEO_MIMES, type SupportVideo,
} from '@/lib/support';

const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';

interface Company { id: string; company_name: string }
interface Draft {
  id?: string; title: string; description: string; module: string; published: boolean;
  all_companies: boolean; company_ids: string[];
  video_path: string | null; thumbnail_path: string | null;
}
const blank: Draft = { title: '', description: '', module: '', published: true, all_companies: true, company_ids: [], video_path: null, thumbnail_path: null };

/** First usable frame of a video file as a JPEG, used as its thumbnail. Null if the browser can't decode it. */
function captureThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (b: Blob | null) => { URL.revokeObjectURL(url); resolve(b); };
    const timer = setTimeout(() => done(null), 8000);
    v.muted = true; v.preload = 'metadata'; v.src = url;
    v.onerror = () => { clearTimeout(timer); done(null); };
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 1) / 2); };
    v.onseeked = () => {
      clearTimeout(timer);
      try {
        const w = Math.min(640, v.videoWidth || 640);
        const h = Math.round(w * ((v.videoHeight || 360) / (v.videoWidth || 640)));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(v, 0, 0, w, h);
        c.toBlob((b) => done(b), 'image/jpeg', 0.8);
      } catch { done(null); }
    };
  });
}

function Thumb({ video, className = '' }: { video: SupportVideo; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    if (video.thumbnail_path) supportFileUrl(video.thumbnail_path).then((u) => { if (!off) setSrc(u); }).catch(() => { /* placeholder stays */ });
    return () => { off = true; };
  }, [video.thumbnail_path]);
  return (
    <div className={`relative aspect-video overflow-hidden rounded-xl bg-slate-900 ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-600"><Film size={32} /></div>}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
        <span className="rounded-full bg-black/60 p-3 text-white opacity-90"><Play size={20} fill="currentColor" /></span>
      </span>
    </div>
  );
}

/** Demo videos: a YouTube-style library for everyone; the Super Admin posts videos and picks the companies. */
export function DemoVideos() {
  const { isSuperAdmin, profile } = useAuth();
  const [videos, setVideos] = useState<SupportVideo[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [playing, setPlaying] = useState<SupportVideo | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [toDelete, setToDelete] = useState<SupportVideo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { setVideos(await supportApi.listVideos(!isSuperAdmin)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load videos.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from('companies').select('id,company_name').order('company_name')
      .then(({ data, error: e }) => { if (e) console.error('Demo videos: companies unavailable', e); else setCompanies((data ?? []) as Company[]); });
  }, [isSuperAdmin]);

  useEffect(() => {
    setPlayUrl(null);
    if (!playing?.video_path) return;
    let off = false;
    supportFileUrl(playing.video_path).then((u) => { if (!off) setPlayUrl(u); }).catch((e) => { if (!off) setError(e?.message ?? 'Video unavailable.'); });
    return () => { off = true; };
  }, [playing]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos.filter((v) => (!moduleFilter || v.module === moduleFilter)
      && (!q || v.title.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)));
  }, [videos, query, moduleFilter]);

  const companyName = (id: string) => companies.find((c) => c.id === id)?.company_name ?? id.slice(0, 8);
  const audience = (v: SupportVideo) => {
    if (v.all_companies) return 'All companies';
    const n = v.company_ids?.length ?? 0;
    if (n === 0) return 'No company selected';
    return n <= 2 ? (v.company_ids ?? []).map(companyName).join(', ') : `${n} companies`;
  };

  const openNew = () => { setEditing({ ...blank }); setNewFile(null); setFormError(''); };
  const openEdit = (v: SupportVideo) => {
    setEditing({ id: v.id, title: v.title, description: v.description, module: v.module, published: v.published, all_companies: v.all_companies, company_ids: v.company_ids ?? [], video_path: v.video_path, thumbnail_path: v.thumbnail_path });
    setNewFile(null); setFormError('');
  };
  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!VIDEO_MIMES.includes(f.type)) { setFormError('Choose an MP4, WebM or MOV video.'); return; }
    if (f.size > DEMO_VIDEO_MAX_BYTES) { setFormError('Videos must be 200 MB or smaller.'); return; }
    setFormError(''); setNewFile(f);
    setEditing((d) => (d && !d.title.trim() ? { ...d, title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') } : d));
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) { setFormError('Give the video a title.'); return; }
    if (!editing.id && !newFile) { setFormError('Choose a video file to upload.'); return; }
    if (!editing.all_companies && editing.company_ids.length === 0) { setFormError('Select at least one company, or choose All companies.'); return; }
    setSaving(true); setFormError('');
    const uploaded: string[] = [];
    try {
      let { video_path, thumbnail_path } = editing;
      const oldPaths = [video_path, thumbnail_path].filter(Boolean) as string[];
      if (newFile) {
        const folder = editing.id ?? crypto.randomUUID();
        video_path = await supportApi.uploadVideoFile(newFile, newFile.name, folder); uploaded.push(video_path);
        const thumb = await captureThumbnail(newFile);
        thumbnail_path = thumb ? await supportApi.uploadVideoFile(thumb, 'thumbnail.jpg', folder) : null;
        if (thumbnail_path) uploaded.push(thumbnail_path);
      }
      await supportApi.saveVideo({ ...editing, video_path, thumbnail_path, created_by_name: profile?.full_name ?? profile?.email ?? null });
      // The previous files are replaced only after the new ones are safely saved.
      if (newFile && oldPaths.length) await supabase.storage.from('support-files').remove(oldPaths);
      setEditing(null); setNewFile(null);
      await load();
    } catch (e) {
      if (uploaded.length) await supabase.storage.from('support-files').remove(uploaded);
      setFormError(e instanceof Error ? e.message : 'Could not save the video.');
    } finally { setSaving(false); }
  };

  const togglePublished = async (v: SupportVideo) => {
    try { await supportApi.saveVideo({ ...v, published: !v.published }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update the video.'); }
  };
  const remove = async () => {
    if (!toDelete) return;
    try { await supportApi.deleteVideo(toDelete.id, [toDelete.video_path, toDelete.thumbnail_path].filter(Boolean) as string[]); setToDelete(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the video.'); setToDelete(null); }
  };

  const toggleCompany = (id: string) => setEditing((d) => d && ({ ...d, company_ids: d.company_ids.includes(id) ? d.company_ids.filter((x) => x !== id) : [...d.company_ids, id] }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          <input aria-label="Search videos" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos…" className={`${field} pl-9`} />
        </div>
        <select aria-label="Filter by module" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className={`${field} w-48`}>
          <option value="">All modules</option>
          {supportModules().map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        {isSuperAdmin && (
          <button type="button" onClick={openNew} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            <Plus size={15} /> Post Video
          </button>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {loading ? <p className="py-10 text-center text-sm text-slate-400">Loading videos…</p> : shown.length === 0 ? (
        <div className="flex flex-col items-center py-14 text-center">
          <Film size={30} className="mb-2 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">{videos.length ? 'No videos match your search.' : 'No demo videos yet.'}</p>
          <p className="mt-1 text-xs text-slate-500">{isSuperAdmin ? 'Click “Post Video” to add the first one.' : 'Videos your administrator shares will appear here.'}</p>
        </div>
      ) : (
        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="video-grid">
          {shown.map((v) => (
            <div key={v.id} data-testid="video-card" className="group">
              <button type="button" onClick={() => setPlaying(v)} className="block w-full text-left" aria-label={`Play ${v.title}`}>
                <Thumb video={v} />
                <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-slate-800">{v.title}</h3>
              </button>
              <p className="text-xs text-slate-500">{v.module ? moduleLabel(v.module) : 'General'}{v.published_at ? ` · ${new Date(v.published_at).toLocaleDateString('en-GB')}` : ''}</p>
              {isSuperAdmin && (
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${v.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{v.published ? 'Published' : 'Draft'}</span>
                  <span className="truncate text-slate-500" title={audience(v)}>{audience(v)}</span>
                  <span className="ml-auto flex shrink-0">
                    <button type="button" aria-label={`${v.published ? 'Unpublish' : 'Publish'} ${v.title}`} title={v.published ? 'Unpublish' : 'Publish'} onClick={() => void togglePublished(v)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">{v.published ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                    <button type="button" aria-label={`Edit ${v.title}`} onClick={() => openEdit(v)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600"><Pencil size={14} /></button>
                    <button type="button" aria-label={`Delete ${v.title}`} onClick={() => setToDelete(v)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 size={14} /></button>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!playing} onClose={() => setPlaying(null)} title={playing?.title ?? 'Video'} size="xl" width={900}>
        {playing && (
          <div className="space-y-3">
            <div className="aspect-video overflow-hidden rounded-xl bg-black">
              {playUrl ? <video key={playUrl} src={playUrl} controls autoPlay className="h-full w-full" /> : <p className="flex h-full items-center justify-center text-sm text-slate-400">Loading video…</p>}
            </div>
            <p className="text-xs text-slate-500">{playing.module ? moduleLabel(playing.module) : 'General'}</p>
            {playing.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{playing.description}</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => !saving && setEditing(null)} title={editing?.id ? 'Edit Video' : 'Post Video'} size="lg"
        footer={<><button type="button" disabled={saving} onClick={() => setEditing(null)} className="px-3 text-sm font-semibold text-slate-600">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : editing?.id ? 'Save changes' : 'Post video'}</button></>}>
        {editing && (
          <div className="space-y-3">
            {formError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Video file {editing.id && <span className="font-normal text-slate-400">(leave empty to keep the current video)</span>}</label>
              <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" aria-label="Video file" onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600 hover:bg-slate-50">
                {newFile ? `${newFile.name} · ${(newFile.size / 1048576).toFixed(1)} MB` : editing.video_path ? 'Replace video…' : 'Choose a video (MP4, WebM or MOV, up to 200 MB)'}
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Title <span className="text-red-500">*</span></label>
              <input aria-label="Video title" className={field} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Description</label>
              <textarea aria-label="Video description" rows={3} className={field} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Module</label>
                <select aria-label="Video module" className={field} value={editing.module} onChange={(e) => setEditing({ ...editing, module: e.target.value })}>
                  <option value="">General</option>
                  {supportModules().map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm font-medium text-slate-700">
                <input type="checkbox" aria-label="Published" checked={editing.published} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} /> Published (visible to users)
              </label>
            </div>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-600">Who can watch</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="aud" aria-label="All companies" checked={editing.all_companies} onChange={() => setEditing({ ...editing, all_companies: true })} /> All companies</label>
              <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="aud" aria-label="Selected companies" checked={!editing.all_companies} onChange={() => setEditing({ ...editing, all_companies: false })} /> Only selected companies</label>
              {!editing.all_companies && (
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
                  {companies.length === 0 && <p className="text-xs text-slate-500">No companies found.</p>}
                  {companies.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Company ${c.company_name}`} checked={editing.company_ids.includes(c.id)} onChange={() => toggleCompany(c.id)} /> {c.company_name}</label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
        )}
      </Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} size="sm" title="Delete video?">
        <p className="text-sm text-slate-600">“{toDelete?.title}” and its files will be permanently removed for every company.</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={() => setToDelete(null)} className="px-3 text-sm font-semibold text-slate-600">Cancel</button>
          <button type="button" onClick={() => void remove()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Delete</button>
        </div>
      </Modal>
    </div>
  );
}
