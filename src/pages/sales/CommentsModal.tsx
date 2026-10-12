import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';

export function CommentsModal({ isOpen, onClose, recordId, recordTitle }: { isOpen: boolean, onClose: () => void, recordId: string, recordTitle: string }) {
  const { profile } = useAuth();
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    if (isOpen && recordId) {
      fetchComments();
    }
  }, [isOpen, recordId]);

  const fetchComments = async () => {
    setLoading(true);
    let fallback = false;
    try {
      const { data, error } = await supabase
        .from('cnc_pipeline_comments')
        .select('*')
        .eq('record_id', recordId)
        .order('created_at', { ascending: true });
        
      if (error) {
        fallback = true;
      } else if (data) {
        setComments(data);
      }
    } catch {
      fallback = true;
    }
    
    if (fallback) {
      setUsingFallback(true);
      const local = JSON.parse(localStorage.getItem('cnc_pipeline_comments') || '[]');
      setComments(local.filter((c: any) => c.record_id === recordId).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
    }
    
    setLoading(false);
  };

  const handlePost = async () => {
    if (!newComment.trim()) return;
    
    const newEntry = {
      id: crypto.randomUUID(),
      record_id: recordId,
      comment: newComment.trim(),
      author_name: profile?.full_name || profile?.email || '',
      created_at: new Date().toISOString()
    };
    
    setComments([...comments, newEntry]);
    setNewComment('');
    
    if (usingFallback) {
       const local = JSON.parse(localStorage.getItem('cnc_pipeline_comments') || '[]');
       local.push(newEntry);
       localStorage.setItem('cnc_pipeline_comments', JSON.stringify(local));
       return;
    }
    
    const { error } = await supabase.from('cnc_pipeline_comments').insert([newEntry]);
    if (error) {
      setUsingFallback(true);
      const local = JSON.parse(localStorage.getItem('cnc_pipeline_comments') || '[]');
      local.push(newEntry);
      localStorage.setItem('cnc_pipeline_comments', JSON.stringify(local));
    }
  };

  return (
    <Modal open={isOpen} onClose={onClose} title={`Comments: ${recordTitle}`} size="md" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col h-[400px]">
        {usingFallback && <div className="bg-amber-50 text-amber-600 text-[10px] p-2 text-center border-b border-amber-100 rounded-t-lg mb-2">Note: Saving locally. Create 'cnc_pipeline_comments' table in Supabase for cloud sync.</div>}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
          {loading ? (
            <div className="text-center text-slate-500 mt-10">Loading comments...</div>
          ) : comments.length === 0 ? (
            <div className="text-center text-slate-500 mt-10 italic text-sm">No comments yet. Be the first to start the conversation!</div>
          ) : (
            comments.map(c => (
              <div key={c.id} className="bg-slate-50 rounded-lg p-3 border border-slate-100 shadow-sm">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[11px] font-bold text-brand-700">{c.author_name || 'User'}</span>
                  <span className="text-[10px] text-slate-400">{new Date(c.created_at).toLocaleString('en-IN', { hour: '2-digit', minute:'2-digit', day:'2-digit', month:'short', hour12: false })}</span>
                </div>
                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{c.comment}</p>
              </div>
            ))
          )}
        </div>
        
        <div className="border-t border-slate-200 pt-3 mt-auto">
          <div className="flex gap-2 items-end">
            <textarea 
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Type your comment here..."
              className="flex-1 border border-slate-300 rounded-lg p-2.5 text-sm focus:outline-none focus:border-brand-500 resize-none h-12 min-h-[48px] max-h-32"
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handlePost();
                }
              }}
            />
            <Button onClick={handlePost} className="bg-brand-600 hover:bg-brand-700 text-white h-12 px-5">Post</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
