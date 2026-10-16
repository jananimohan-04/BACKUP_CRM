import { createFileRoute } from "@/vault/router-adapter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listProfiles, listRoles, listUserRoles, listParties, setUserRole, updateProfile, createAuthUserWithoutLogin } from "@/vault/lib/api";
import { GoogleDriveService } from "@/vault/services/google-drive";
import { usePermissions } from "@/vault/hooks/use-permissions";
import { supabase } from "@/vault/integrations/supabase/client";
import { Button } from "@/vault/components/ui/button";
import { Input } from "@/vault/components/ui/input";
import { Label } from "@/vault/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/vault/components/ui/table";
import { Badge } from "@/vault/components/ui/badge";
import { format } from "date-fns";
import { Users, Shield, MoreHorizontal, ShieldOff, Edit, Plus, Building, UserPlus, Loader2, Check } from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/vault/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/vault/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/vault/components/ui/select";
import { toast } from "sonner";
import { CreatePartyModal } from "@/vault/components/create-party-modal";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
});

function InviteUserModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { isSuperAdmin, userPartyId } = usePermissions();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("User@1234");
  const [partyId, setPartyId] = useState<string>(userPartyId || "internal");
  const [isCreateCompanyOpen, setIsCreateCompanyOpen] = useState(false);
  const [roleId, setRoleId] = useState<string>("");
  const [department, setDepartment] = useState("");

  const { data: parties } = useQuery({ queryKey: ["parties-list"], queryFn: listParties });
  const { data: roles } = useQuery({ queryKey: ["roles-list"], queryFn: listRoles });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      if (!email || !fullName) throw new Error("Email and Full Name are required");
      
      // 1. Create auth user without logging out active session
      let userId: string;
      try {
        const user = await createAuthUserWithoutLogin(email, password, fullName);
        userId = user.id;
      } catch (authErr: any) {
        console.warn("Auth signup notice:", authErr?.message);
        userId = crypto.randomUUID();
      }

      // 2. Sync to Main ERP company_users
      try {
        await supabase.from("company_users").upsert({
          auth_user_id: userId,
          email: email.trim().toLowerCase(),
          full_name: fullName.trim(),
          role: "USER",
          status: "Active"
        }, { onConflict: "email" });
      } catch (erpErr) {
        console.warn("Could not insert company_users:", erpErr);
      }

      // 3. Save Profile into cncvault_profiles
      await updateProfile(userId, {
        full_name: fullName.trim(),
        email: email.trim(),
        party_id: partyId === "internal" ? null : partyId,
        department: department.trim() || null,
        status: "Active"
      });

      // 4. Assign Role if selected
      if (roleId) {
        await setUserRole(userId, roleId);
      }

      // 5. Automatically share Google Drive folder with the new user
      if (partyId && partyId !== "internal") {
        try {
          await GoogleDriveService.shareFolder(partyId, email.trim());
        } catch (e) {
          console.warn("Could not automatically share Google Drive folder:", e);
        }
      }
    },
    onSuccess: () => {
      toast.success(`User created successfully! Default password: ${password}`);
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      queryClient.invalidateQueries({ queryKey: ["user-roles-list"] });
      setFullName("");
      setEmail("");
      setDepartment("");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to create user");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-900">
            <UserPlus className="w-5 h-5 text-indigo-600" />
            Invite & Create User
          </DialogTitle>
          <DialogDescription>
            Add a new user and assign them to a Company and Role.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input placeholder="John Doe" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email Address *</Label>
              <Input type="email" placeholder="john@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-[11px] text-slate-500">Default temporary password for first sign in.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Assign to Company</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-medium px-2 flex items-center gap-1"
                onClick={() => setIsCreateCompanyOpen(true)}
              >
                <Plus className="w-3 h-3" />
                + Create Company
              </Button>
            </div>
            <Select value={partyId} onValueChange={(val) => {
              if (val === "CREATE_NEW") {
                setIsCreateCompanyOpen(true);
                return;
              }
              setPartyId(val);
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select Company..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CREATE_NEW" className="font-medium text-indigo-600 border-b border-slate-100 bg-indigo-50/50 hover:bg-indigo-100/50 cursor-pointer">
                  ✨ + Create New Company...
                </SelectItem>
                <SelectItem value="internal">🏢 Internal / Super Admin Access</SelectItem>
                {parties?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>🏢 {p.name} ({p.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-500">Users will only have access to documents & parts of their assigned Company.</p>
          </div>

          <CreatePartyModal
            open={isCreateCompanyOpen}
            onOpenChange={setIsCreateCompanyOpen}
            onPartyCreated={(newParty) => setPartyId(newParty.id)}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Assign Role</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles?.map((r) => (
                    <SelectItem key={r.id} value={r.id}>🛡️ {r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input placeholder="e.g. Engineering" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button 
            className="bg-indigo-600 hover:bg-indigo-700" 
            onClick={() => inviteMutation.mutate()} 
            disabled={inviteMutation.isPending || !fullName.trim() || !email.trim()}
          >
            {inviteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
            Create User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserModal({ profile, open, onOpenChange }: { profile: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [partyId, setPartyId] = useState<string>(profile?.party_id || "internal");
  const [isCreateCompanyOpen, setIsCreateCompanyOpen] = useState(false);
  const [department, setDepartment] = useState(profile?.department || "");

  const { data: parties } = useQuery({ queryKey: ["parties-list"], queryFn: listParties });

  const updateMutation = useMutation({
    mutationFn: async () => {
      await updateProfile(profile.user_id, {
        party_id: partyId === "internal" ? null : partyId,
        department: department.trim() || null
      });
    },
    onSuccess: () => {
      toast.success("User profile updated successfully!");
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update profile");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit User Profile & Company</DialogTitle>
          <DialogDescription>Change company assignment and department for {profile?.full_name || profile?.email}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Company Assignment</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-medium px-2 flex items-center gap-1"
                onClick={() => setIsCreateCompanyOpen(true)}
              >
                <Plus className="w-3 h-3" />
                + Create Company
              </Button>
            </div>
            <Select value={partyId} onValueChange={(val) => {
              if (val === "CREATE_NEW") {
                setIsCreateCompanyOpen(true);
                return;
              }
              setPartyId(val);
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Select Company..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CREATE_NEW" className="font-medium text-indigo-600 border-b border-slate-100 bg-indigo-50/50 hover:bg-indigo-100/50 cursor-pointer">
                  ✨ + Create New Company...
                </SelectItem>
                <SelectItem value="internal">🏢 Internal / Super Admin Access</SelectItem>
                {parties?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>🏢 {p.name} ({p.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <CreatePartyModal
            open={isCreateCompanyOpen}
            onOpenChange={setIsCreateCompanyOpen}
            onPartyCreated={(newParty) => setPartyId(newParty.id)}
          />

          <div className="space-y-2">
            <Label>Department</Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageRoleModal({ profile, currentRoleId, open, onOpenChange }: { profile: any; currentRoleId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [roleId, setRoleId] = useState<string>(currentRoleId || "");

  const { data: roles } = useQuery({ queryKey: ["roles-list"], queryFn: listRoles });

  const roleMutation = useMutation({
    mutationFn: async () => {
      if (!roleId) throw new Error("Please select a role");
      const targetUserId = profile.user_id || profile.id || profile.auth_user_id || profile.erp_user_id;
      await setUserRole(targetUserId, roleId);
    },
    onSuccess: () => {
      toast.success("Part & Drawings role updated successfully!");
      queryClient.invalidateQueries({ queryKey: ["user-roles-list"] });
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update role");
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Part & Drawings Role & Permissions</DialogTitle>
          <DialogDescription>Assign Part & Drawings access role to {profile?.full_name || profile?.email}.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-2">
            <Label>Select Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Select Role..." />
              </SelectTrigger>
              <SelectContent>
                {roles?.map((r) => (
                  <SelectItem key={r.id} value={r.id}>🛡️ {r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => roleMutation.mutate()} disabled={roleMutation.isPending}>
            {roleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : "Update Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersPage() {
  const { can, isSuperAdmin, userPartyId } = usePermissions();
  const queryClient = useQueryClient();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<any>(null);
  const [roleManagingProfile, setRoleManagingProfile] = useState<any>(null);

  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ["users-list", isSuperAdmin ? "all" : userPartyId],
    queryFn: () => listProfiles(isSuperAdmin ? undefined : (userPartyId || undefined)),
    enabled: can("manage_users"),
  });

  const { data: roles } = useQuery({
    queryKey: ["roles-list"],
    queryFn: listRoles,
    enabled: can("manage_users"),
  });

  const { data: userRoles, isLoading: rolesLoading } = useQuery({
    queryKey: ["user-roles-list"],
    queryFn: listUserRoles,
    enabled: can("manage_users"),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ userId, newStatus }: { userId: string; newStatus: "Active" | "Inactive" }) => {
      await updateProfile(userId, { status: newStatus });
    },
    onSuccess: () => {
      toast.success("User status updated");
      queryClient.invalidateQueries({ queryKey: ["users-list"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to update status");
    }
  });

  if (!can("manage_users")) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <ShieldOff className="w-16 h-16 text-slate-300 mb-4" />
        <h2 className="text-2xl font-bold text-slate-900">Access Denied</h2>
        <p className="text-slate-500 mt-2 max-w-md">
          You do not have permission to view or manage users. Please contact your system administrator.
        </p>
      </div>
    );
  }

  const isLoading = profilesLoading || rolesLoading;

  const getUserRole = (profileOrId: any) => {
    if (!profileOrId) return null;
    const id = typeof profileOrId === 'string' ? profileOrId : (profileOrId.user_id || profileOrId.id);
    const authId = typeof profileOrId === 'object' ? profileOrId.auth_user_id : undefined;
    const erpId = typeof profileOrId === 'object' ? profileOrId.erp_user_id : undefined;
    const erpRole = typeof profileOrId === 'object' ? profileOrId.erp_role : undefined;

    const ur = userRoles?.find(r => r.user_id === id || (authId && r.user_id === authId) || (erpId && r.user_id === erpId));
    if (ur) {
      const match = roles?.find(r => r.id === ur.role_id);
      if (match) return match;
    }

    if (erpRole === 'SUPER_ADMIN') {
      return roles?.find(r => r.name === 'Super Admin') || null;
    }
    if (erpRole === 'COMPANY_ADMIN') {
      return roles?.find(r => r.name === 'Admin') || null;
    }
    if (erpRole === 'USER') {
      return roles?.find(r => r.name === 'Viewer') || null;
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Users & Access Control</h2>
          <p className="text-muted-foreground mt-1">
            Manage ERP users and control their Part & Drawings access permissions.
          </p>
        </div>
        <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => setIsInviteOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Invite User
        </Button>
      </div>

      <InviteUserModal open={isInviteOpen} onOpenChange={setIsInviteOpen} />

      {editingProfile && (
        <EditUserModal 
          profile={editingProfile} 
          open={!!editingProfile} 
          onOpenChange={(open) => !open && setEditingProfile(null)} 
        />
      )}

      {roleManagingProfile && (
        <ManageRoleModal 
          profile={roleManagingProfile} 
          currentRoleId={getUserRole(roleManagingProfile)?.id || ""} 
          open={!!roleManagingProfile} 
          onOpenChange={(open) => !open && setRoleManagingProfile(null)} 
        />
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>User Profile</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Part & Drawings Role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : !profiles || profiles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center">
                    <Users className="w-8 h-8 text-slate-300 mb-2" />
                    <p>No users found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              profiles.map((profile: any) => {
                const userRole = getUserRole(profile);
                return (
                  <TableRow key={profile.id} className="hover:bg-slate-50">
                    <TableCell>
                      <div className="font-semibold text-slate-900">{profile.full_name || "User"}</div>
                      <div className="text-xs text-indigo-600 font-medium">{profile.email}</div>
                    </TableCell>

                    <TableCell>
                      {profile.party ? (
                        <Badge variant="outline" className="bg-indigo-50/50 text-indigo-700 border-indigo-200">
                          <Building className="w-3 h-3 mr-1" />
                          {profile.party.name}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200">
                          Super Admin / Internal
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell>
                      {userRole ? (
                        <Badge variant="secondary" className="font-normal bg-purple-50 text-purple-700 border border-purple-200">
                          <Shield className="w-3 h-3 mr-1 text-purple-600" />
                          {userRole.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No Role</span>
                      )}
                    </TableCell>

                    <TableCell className="text-sm text-slate-700">
                      {profile.department || "—"}
                    </TableCell>

                    <TableCell>
                      <Badge variant={profile.status === "Active" ? "default" : "secondary"}>
                        {profile.status}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-sm text-slate-500">
                      {format(new Date(profile.created_at), "MMM d, yyyy")}
                    </TableCell>

                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditingProfile(profile)}>
                            <Edit className="mr-2 h-4 w-4 text-indigo-600" /> Edit Profile & Company
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRoleManagingProfile(profile)}>
                            <Shield className="mr-2 h-4 w-4 text-purple-600" /> Manage Part & Drawings Role
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className={profile.status === "Active" ? "text-red-600" : "text-green-600"}
                            onClick={() => toggleStatusMutation.mutate({ 
                              userId: profile.user_id, 
                              newStatus: profile.status === "Active" ? "Inactive" : "Active" 
                            })}
                          >
                            <ShieldOff className="mr-2 h-4 w-4" /> 
                            {profile.status === "Active" ? "Deactivate User" : "Activate User"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
