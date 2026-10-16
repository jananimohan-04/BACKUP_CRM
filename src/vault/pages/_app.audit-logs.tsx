import { createFileRoute } from "@/vault/router-adapter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listAuditLogs } from "@/vault/lib/api";
import { usePermissions } from "@/vault/hooks/use-permissions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/vault/components/ui/table";
import { Badge } from "@/vault/components/ui/badge";
import { Input } from "@/vault/components/ui/input";
import { ShieldOff, Activity, Search, FilterX } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/vault/components/ui/button";

export const Route = createFileRoute("/_app/audit-logs")({
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const { can } = usePermissions();
  const [searchDoc, setSearchDoc] = useState("");
  const [searchUser, setSearchUser] = useState("");

  const { data: logs, isLoading } = useQuery({
    queryKey: ["audit-logs", searchDoc, searchUser],
    queryFn: () => listAuditLogs({ 
      documentNumber: searchDoc || undefined,
      user: searchUser || undefined,
      limit: 100 
    }),
    enabled: can("view_audit"),
  });

  if (!can("view_audit")) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <ShieldOff className="w-16 h-16 text-slate-300 mb-4" />
        <h2 className="text-2xl font-bold text-slate-900">Access Denied</h2>
        <p className="text-slate-500 mt-2 max-w-md">
          You do not have permission to view audit logs.
        </p>
      </div>
    );
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case "LOGIN":
      case "VIEW": return "bg-blue-100 text-blue-800 border-blue-200";
      case "DOWNLOAD": return "bg-purple-100 text-purple-800 border-purple-200";
      case "UPLOAD":
      case "NEW_VERSION": return "bg-green-100 text-green-800 border-green-200";
      case "EDIT":
      case "PERMISSION_CHANGE":
      case "STATUS_CHANGE": return "bg-amber-100 text-amber-800 border-amber-200";
      case "DELETE": return "bg-red-100 text-red-800 border-red-200";
      case "APPROVAL": return "bg-emerald-100 text-emerald-800 border-emerald-200";
      default: return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Audit Logs</h2>
        <p className="text-muted-foreground mt-1">
          System-wide immutable record of all actions and access.
        </p>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Search by Document Number..."
            className="pl-9"
            value={searchDoc}
            onChange={(e) => setSearchDoc(e.target.value)}
          />
        </div>
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <Input
            placeholder="Search by User..."
            className="pl-9"
            value={searchUser}
            onChange={(e) => setSearchUser(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => { setSearchDoc(""); setSearchUser(""); }}>
          <FilterX className="w-4 h-4 mr-2" />
          Reset
        </Button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Document / Company</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                  Loading audit logs...
                </TableCell>
              </TableRow>
            ) : !logs || logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center">
                    <Activity className="w-8 h-8 text-slate-300 mb-2" />
                    <p>No audit logs found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id} className="hover:bg-slate-50">
                  <TableCell className="text-sm whitespace-nowrap text-slate-600">
                    {format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss")}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900">
                    {log.user_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`font-mono text-[10px] ${getActionColor(log.action)}`}>
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {log.document_number && <div className="font-medium text-indigo-600">{log.document_number} {log.version ? `(V${log.version})` : ''}</div>}
                    {log.party_name && <div className="text-xs text-slate-500">{log.party_name}</div>}
                    {!log.document_number && !log.party_name && <span className="text-slate-400">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600 max-w-[300px] truncate" title={log.details || ""}>
                    {log.details || "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
