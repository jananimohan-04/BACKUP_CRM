import { createFileRoute } from "@/vault/router-adapter";
import { useQuery } from "@tanstack/react-query";
import { getDocument, listVersions, listDocumentPermissions } from "@/vault/lib/api";
import { supabase } from "@/vault/integrations/supabase/client";
import { usePermissions } from "@/vault/hooks/use-permissions";
import { GoogleDriveService } from "@/vault/services/google-drive";
import { Button } from "@/vault/components/ui/button";
import { Badge } from "@/vault/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/vault/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/vault/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/vault/components/ui/table";
import { format } from "date-fns";
import { formatBytes } from "@/vault/lib/rbac";
import { Download, Upload, Eye, Shield, FileText, History, Info, ChevronLeft, ExternalLink, Laptop } from "lucide-react";
import { Link } from "@/vault/router-adapter";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/vault/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/vault/components/ui/select";
import { Checkbox } from "@/vault/components/ui/checkbox";
import { listProfiles, listRoles, replaceDocumentPermissions } from "@/vault/lib/api";
import { useState } from "react";


export const Route = createFileRoute("/_app/documents/$documentId")({
  component: DocumentDetailPage,
});

function DocumentDetailPage() {
  const { documentId } = Route.useParams();
  const { can } = usePermissions();

  const handleOpenLocally = async (documentInfo: any, version: any) => {
    toast.loading("Opening document locally...");
    try {
      let basePath = localStorage.getItem("localDrivePath") || "G:\\My Drive\\CNC Vault";
      if (basePath.endsWith('\\')) basePath = basePath.slice(0, -1);
      if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
      const fullPath = `${basePath}\\${documentInfo.document_number}\\V${version.version_number}\\${version.file_name}`;

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      const fileId = version.google_drive_file_id || version.drive_file_id;
      const downloadUrl = fileId 
        ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-api/download?fileId=${fileId}&documentId=${documentInfo.id}` 
        : "";

      const payloadObj = {
        fileName: version.file_name,
        documentNumber: documentInfo.document_number,
        versionNumber: version.version_number,
        fullPath: fullPath,
        downloadUrl: downloadUrl,
        authToken: token,
      };

      const base64EncodeUnicode = (str: string) => {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
            function toSolidBytes(_match, p1) {
                return String.fromCharCode(parseInt(p1, 16));
        }));
      };
      const encodedPayload = base64EncodeUnicode(JSON.stringify(payloadObj));
      window.location.href = `cncvault://open?b64payload=${encodedPayload}`;
      setTimeout(() => toast.dismiss(), 2000);
    } catch (err: any) {
      toast.dismiss();
      toast.error(err.message || "Failed to initiate local launcher");
    }
  };

  const { data: doc, isLoading: docLoading } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => getDocument(documentId),
  });

  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ["document-versions", documentId],
    queryFn: () => listVersions(documentId),
  });

  const { data: permissions, isLoading: permsLoading } = useQuery({
    queryKey: ["document-permissions", documentId],
    queryFn: () => listDocumentPermissions(documentId),
  });

  if (docLoading) {
    return <div className="p-8 text-center text-slate-500">Loading document details...</div>;
  }

  if (!doc) {
    return <div className="p-8 text-center text-red-500">Document not found or you don't have access.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
        <Link to="/documents" className="hover:text-indigo-600 flex items-center">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Documents
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">{doc.document_number}</h2>
            <Badge variant={doc.status === "Approved" || doc.status === "Released" ? "default" : "secondary"} className="text-sm">
              {doc.status}
            </Badge>
            <Badge variant="outline" className="text-sm border-indigo-200 text-indigo-700 bg-indigo-50">
              V{doc.current_version}
            </Badge>
          </div>
          <p className="text-xl text-slate-600 mt-1">{doc.document_name}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {can("view") && (
            <Button variant="outline" className="bg-white" onClick={() => {
              if (versions && versions.length > 0) {
                const latest = versions[0];
                GoogleDriveService.getViewUrl(latest.google_drive_file_id, documentId)
                  .then(url => window.open(url, '_blank'))
                  .catch(e => toast.error(e.message));
              }
            }}>
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </Button>
          )}
          {can("download") && (
            <Button variant="outline" className="bg-white" onClick={() => {
              if (versions && versions.length > 0) {
                const latest = versions[0];
                GoogleDriveService.downloadFile(latest.google_drive_file_id, documentId, latest.file_name).catch(e => toast.error(e.message));
              }
            }}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          )}
          {versions?.[0]?.google_drive_file_id && (
              <>
                <Button 
                  variant="outline" 
                  className="bg-white hover:bg-slate-50 text-indigo-600 border-slate-200"
                  onClick={() => handleOpenLocally(doc, versions[0])}
                >
                  <Laptop className="w-4 h-4 mr-2" />
                  Open Locally
                </Button>
                <Button 
                  variant="outline" 
                  className="bg-white hover:bg-slate-50 text-slate-700 border-slate-200"
                  onClick={() => window.open(`https://drive.google.com/file/d/${versions[0].google_drive_file_id}/view`, '_blank')}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open in Drive
                </Button>
              </>
            )}
          {can("upload") && (
            <Button className="bg-indigo-600 hover:bg-indigo-700">
              <Upload className="w-4 h-4 mr-2" />
              New Version
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="details" className="w-full">
        <TabsList className="bg-slate-100 p-1">
          <TabsTrigger value="details" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Info className="w-4 h-4 mr-2" /> Details
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <History className="w-4 h-4 mr-2" /> Version History
          </TabsTrigger>
          <TabsTrigger value="access" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Shield className="w-4 h-4 mr-2" /> Access
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Document Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-slate-500">Document Type</div>
                    <div className="font-medium">{doc.document_type || "—"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">File Type</div>
                    <div className="font-medium uppercase">{doc.file_type || "—"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Description</div>
                    <div className="font-medium col-span-2">{doc.description || "—"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Part & Company Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-slate-500">Company</div>
                    <div className="font-medium">{doc.parties?.name || "Internal"}</div>
                  </div>
                  {(doc as any)?.parts?.part_name && (
                    <div>
                      <div className="text-sm text-slate-500">Linked Product</div>
                      <div className="font-medium">{(doc as any).parts.part_name}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-sm text-slate-500">Drawing Number</div>
                    <div className="font-medium">{doc.drawing_number || "—"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-200 md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Lifecycle Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-slate-500">Created By</div>
                    <div className="font-medium">{doc.created_by_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Created Date</div>
                    <div className="font-medium">{format(new Date(doc.created_at), "MMM d, yyyy")}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Last Updated By</div>
                    <div className="font-medium">{doc.updated_by_name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500">Last Updated</div>
                    <div className="font-medium">{format(new Date(doc.updated_at), "MMM d, yyyy")}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card className="shadow-sm border-slate-200">
            <CardHeader>
              <CardTitle>Revision History</CardTitle>
              <CardDescription>
                Versions are immutable. Newer versions supersede older ones.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {versionsLoading ? (
                <div className="text-center text-slate-500 py-8">Loading history...</div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead className="w-20">Ver</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions?.map((v) => (
                      <TableRow key={v.id} className={v.version_number === doc.current_version ? "bg-indigo-50/50" : ""}>
                        <TableCell className="font-medium">V{v.version_number}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-400" />
                            <span className="truncate max-w-[150px]" title={v.file_name}>{v.file_name}</span>
                            <span className="text-xs text-slate-500">({formatBytes(v.file_size)})</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm" title={v.revision_notes || ""}>
                          {v.revision_notes || "—"}
                        </TableCell>
                        <TableCell className="text-sm">{v.uploaded_by_name}</TableCell>
                        <TableCell className="text-sm text-slate-500">{format(new Date(v.uploaded_at), "MMM d, yyyy")}</TableCell>
                        <TableCell>
                          <Badge variant={v.status === "Approved" || v.status === "Released" ? "default" : v.status === "Superseded" ? "secondary" : "outline"} className="text-xs">
                            {v.version_number === doc.current_version ? "Current" : "Superseded"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {can("view") && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500" title="Preview" onClick={() => {
                                  GoogleDriveService.getViewUrl(v.google_drive_file_id, documentId)
                                    .then(url => window.open(url, '_blank'))
                                    .catch(e => toast.error(e.message));
                              }}>
                                <Eye className="w-4 h-4" />
                              </Button>
                            )}
                            {can("download") && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500" title="Download" onClick={() => GoogleDriveService.downloadFile(v.google_drive_file_id, documentId, v.file_name)}>
                                <Download className="w-4 h-4" />
                              </Button>
                            )}
                            {v.google_drive_file_id && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" 
                                title="Open in Google Drive" 
                                onClick={() => window.open(`https://drive.google.com/file/d/${v.google_drive_file_id}/view`, '_blank')}
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="access" className="mt-6">
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Document Access Control</CardTitle>
                <CardDescription>
                  Manage who can view, download, or edit this document.
                </CardDescription>
              </div>
              {can("manage_access") && (
                <ManageAccessDialog 
                  documentId={documentId} 
                  currentPermissions={permissions || []} 
                  onSaved={() => {
                    toast.success("Permissions updated successfully");
                    window.location.reload();
                  }} 
                />
              )}
            </CardHeader>
            <CardContent>
              {permsLoading ? (
                <div className="text-center text-slate-500 py-8">Loading permissions...</div>
              ) : (
                <Table>
                  <TableHeader className="bg-slate-50">
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-center">View</TableHead>
                      <TableHead className="text-center">Download</TableHead>
                      <TableHead className="text-center">Edit / Upload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {permissions?.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Badge variant="outline">
                            {p.user_id ? "User" : p.role_id ? "Role" : "Department"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {p.profiles?.full_name || p.roles?.name || p.department || "Unknown"}
                        </TableCell>
                        <TableCell className="text-center">
                          {p.permissions.includes("view") ? <span className="text-green-500">?</span> : <span className="text-red-500">?</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {p.permissions.includes("download") ? <span className="text-green-500">?</span> : <span className="text-red-500">?</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {p.permissions.includes("edit") || p.permissions.includes("upload") ? <span className="text-green-500">?</span> : <span className="text-red-500">?</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!permissions || permissions.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500 py-6">
                          No specific permissions set. Default access rules apply.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}


function ManageAccessDialog({ documentId, currentPermissions, onSaved }: { documentId: string, currentPermissions: any[], onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [perms, setPerms] = useState<any[]>([]);

  // Ensure dialog opens with fresh state
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      setPerms(currentPermissions.map(p => ({...p})));
    }
  };

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: listProfiles
  });
  
  const { data: roles } = useQuery({
    queryKey: ["roles"],
    queryFn: listRoles
  });

  const [newRuleType, setNewRuleType] = useState<"user" | "role" | "department">("user");
  const [newRuleTarget, setNewRuleTarget] = useState<string>("");

  const handleAddRule = () => {
    if (!newRuleTarget) return;
    
    const newPerm = {
      document_id: documentId,
      user_id: newRuleType === "user" ? newRuleTarget : null,
      role_id: newRuleType === "role" ? newRuleTarget : null,
      department: newRuleType === "department" ? newRuleTarget : null,
      permissions: ["view"], // default to view
      profiles: newRuleType === "user" ? { full_name: users?.find((u: any) => u.user_id === newRuleTarget)?.full_name } : null,
      roles: newRuleType === "role" ? { name: roles?.find((r: any) => r.id === newRuleTarget)?.name } : null,
    };
    
    setPerms([...perms, newPerm]);
    setNewRuleTarget("");
  };

  const handleRemoveRule = (index: number) => {
    const newPerms = [...perms];
    newPerms.splice(index, 1);
    setPerms(newPerms);
  };

  const togglePermission = (index: number, perm: string, checked: boolean) => {
    const newPerms = [...perms];
    if (checked) {
      if (!newPerms[index].permissions.includes(perm)) newPerms[index].permissions.push(perm);
    } else {
      newPerms[index].permissions = newPerms[index].permissions.filter((p: string) => p !== perm);
    }
    setPerms(newPerms);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const rowsToSave = perms.map(p => {
        return {
          document_id: p.document_id,
          user_id: p.user_id,
          role_id: p.role_id,
          department: p.department,
          permissions: p.permissions
        };
      });
      await replaceDocumentPermissions(documentId, rowsToSave);
      setOpen(false);
      onSaved();
    } catch (err: any) {
      toast.error("Failed to save permissions: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Manage Access</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Document Access</DialogTitle>
          <DialogDescription>
            Add explicit access rules for this document. Rules are additive.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          
          <div className="flex gap-2 items-end bg-slate-50 p-4 rounded-lg border">
            <div className="space-y-1 w-1/3">
              <Label className="text-xs">Rule Type</Label>
              <Select value={newRuleType} onValueChange={(v: any) => { setNewRuleType(v); setNewRuleTarget(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Specific User</SelectItem>
                  <SelectItem value="role">Role</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1">
              <Label className="text-xs">Select Target</Label>
              {newRuleType === "user" && (
                <Select value={newRuleTarget} onValueChange={setNewRuleTarget}>
                  <SelectTrigger><SelectValue placeholder="Select a user..." /></SelectTrigger>
                  <SelectContent>
                    {users?.map((u: any) => <SelectItem key={u.user_id} value={u.user_id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {newRuleType === "role" && (
                <Select value={newRuleTarget} onValueChange={setNewRuleTarget}>
                  <SelectTrigger><SelectValue placeholder="Select a role..." /></SelectTrigger>
                  <SelectContent>
                    {roles?.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button onClick={handleAddRule} disabled={!newRuleTarget} variant="secondary">Add Rule</Button>
          </div>

          <div className="max-h-[300px] overflow-y-auto border rounded-md">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0">
                <TableRow>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-center w-20">View</TableHead>
                  <TableHead className="text-center w-20">Download</TableHead>
                  <TableHead className="text-center w-20">Edit</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perms.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">
                      <div className="flex flex-col">
                        <span>{p.profiles?.full_name || p.roles?.name || p.department}</span>
                        <span className="text-xs text-slate-500">{p.user_id ? "User" : p.role_id ? "Role" : "Department"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox 
                        checked={p.permissions.includes("view")} 
                        onCheckedChange={(c) => togglePermission(i, "view", !!c)} 
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox 
                        checked={p.permissions.includes("download")} 
                        onCheckedChange={(c) => togglePermission(i, "download", !!c)} 
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox 
                        checked={p.permissions.includes("edit")} 
                        onCheckedChange={(c) => togglePermission(i, "edit", !!c)} 
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-8 w-8 text-red-500 p-0" onClick={() => handleRemoveRule(i)}>?</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {perms.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-500 py-6 text-sm">
                      No explicit access rules.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Permissions"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
