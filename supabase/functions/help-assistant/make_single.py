"""Builds dashboard-paste.ts (one file) from knowledge.ts + index.ts, for pasting into the Supabase dashboard.
Run from this folder:  python make_single.py"""
import re

k = open('knowledge.ts', encoding='utf8').read()
i = open('index.ts', encoding='utf8').read()
i = re.sub(r"import \{ pickNotes \} from './knowledge\.ts';\n", "", i)
imp = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';\n"
i = i.replace(imp, "")
out = (
    "// SINGLE-FILE VERSION for pasting into the Supabase dashboard (Edge Functions > help-assistant).\n"
    "// Generated from knowledge.ts + index.ts. Edit those, then regenerate: python make_single.py\n\n"
    + imp + "\n// ===================== knowledge.ts =====================\n" + k
    + "\n// ===================== index.ts =====================\n" + i
)
open('dashboard-paste.ts', 'w', encoding='utf8').write(out)
print('written', len(out.splitlines()), 'lines')
