import { createFileRoute } from "@/vault/router-adapter";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/vault/components/ui/dialog";
import { Input } from "@/vault/components/ui/input";
import { Label } from "@/vault/components/ui/label";
import { toast } from "sonner";
import { createParty, updateParty, Party } from "@/vault/lib/api";

import { useQuery } from "@tanstack/react-query";
import { listParties } from "@/vault/lib/api";
import { usePermissions } from "@/vault/hooks/use-permissions";
import { Button } from "@/vault/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/vault/components/ui/table";
import { Badge } from "@/vault/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/vault/components/ui/select";
import { format } from "date-fns";
import { Building2, Plus, Mail, Phone, MoreHorizontal, Edit, Archive, Eye } from "lucide-react";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/vault/components/ui/dropdown-menu";

export const Route = createFileRoute("/_app/parties")({
  component: PartiesPage,
});

function AddPartyDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) return toast.error("Name and Code are required");
    
    setLoading(true);
    try {
      await createParty({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        contact_person: contact.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        status: "Active"
      });
      toast.success("Company added successfully");
      setOpen(false);
      onAdded();
      setName(""); setCode(""); setContact(""); setEmail(""); setPhone("");
    } catch (err: any) {
      toast.error(err.message || "Failed to add company");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Party
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Party</DialogTitle>
          <DialogDescription>
            Create a new company, supplier, or internal department.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company / Party Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. ABC Engineering" />
            </div>
            <div className="space-y-2">
              <Label>Code / Short Name *</Label>
              <Input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. ABC" maxLength={10} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Contact Person</Label>
            <Input value={contact} onChange={e => setContact(e.target.value)} placeholder="e.g. John Doe" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="john@example.com" />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555-0199" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Add Party"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewPartyModal({ party, open, onOpenChange }: { party: Party | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!party) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-900">
            <Building2 className="w-5 h-5 text-indigo-600" />
            {party.name}
          </DialogTitle>
          <DialogDescription>Party / Company profile and contact information.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Party Name:</span>
            <span className="font-semibold text-slate-800">{party.name}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Code:</span>
            <Badge variant="outline" className="font-mono">{party.code}</Badge>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Contact Person:</span>
            <span className="text-slate-800">{party.contact_person || "—"}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Email:</span>
            <span className="text-slate-800">{party.email || "—"}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Phone:</span>
            <span className="text-slate-800">{party.phone || "—"}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Status:</span>
            <Badge variant={party.status === "Active" ? "default" : "secondary"}>{party.status}</Badge>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-slate-500 font-medium">Created Date:</span>
            <span className="text-slate-800">{party.created_at ? format(new Date(party.created_at), "MMM d, yyyy") : "—"}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPartyModal({ party, open, onOpenChange, onSaved }: { party: Party | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(party?.name || "");
  const [code, setCode] = useState(party?.code || "");
  const [contact, setContact] = useState(party?.contact_person || "");
  const [email, setEmail] = useState(party?.email || "");
  const [phone, setPhone] = useState(party?.phone || "");
  const [status, setStatus] = useState<"Active" | "Inactive">(party?.status || "Active");

  useEffect(() => {
    if (party) {
      setName(party.name || "");
      setCode(party.code || "");
      setContact(party.contact_person || "");
      setEmail(party.email || "");
      setPhone(party.phone || "");
      setStatus((party.status as "Active" | "Inactive") || "Active");
    }
  }, [party]);

  const handleUpdate = async () => {
    if (!party) return;
    if (!name.trim() || !code.trim()) return toast.error("Name and Code are required");

    setLoading(true);
    try {
      await updateParty(party.id, {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        contact_person: contact.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        status: status,
      });
      toast.success("Company updated successfully!");
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update company");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-900">
            <Edit className="w-5 h-5 text-indigo-600" />
            Edit Party Details
          </DialogTitle>
          <DialogDescription>Update company or party profile information.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Party Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Code *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={10} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Contact Person</Label>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(val: "Active" | "Inactive") => setStatus(val)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={handleUpdate} disabled={loading}>
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartiesPage() {
  const { can, isSuperAdmin, isCompanyAdmin } = usePermissions();
  const [selectedPartyForView, setSelectedPartyForView] = useState<Party | null>(null);
  const [selectedPartyForEdit, setSelectedPartyForEdit] = useState<Party | null>(null);
  
  const { data: parties, isLoading, refetch } = useQuery({
    queryKey: ["parties-list"],
    queryFn: listParties,
  });

  const displayParties = parties || [];

  const handleArchiveToggle = async (party: Party) => {
    const newStatus = party.status === "Active" ? "Inactive" : "Active";
    try {
      await updateParty(party.id, { status: newStatus });
      toast.success(`Party "${party.name}" status changed to ${newStatus}`);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to update party status");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Parties</h2>
          <p className="text-muted-foreground mt-1">
            Manage companies, suppliers, vendors, and internal departments.
          </p>
        </div>
        {(isSuperAdmin || isCompanyAdmin || can("manage_parties")) && (
          <AddPartyDialog onAdded={() => refetch()} />
        )}
      </div>

      <ViewPartyModal 
        party={selectedPartyForView} 
        open={!!selectedPartyForView} 
        onOpenChange={(open) => !open && setSelectedPartyForView(null)} 
      />

      <EditPartyModal 
        party={selectedPartyForEdit} 
        open={!!selectedPartyForEdit} 
        onOpenChange={(open) => !open && setSelectedPartyForEdit(null)} 
        onSaved={() => refetch()} 
      />

      <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead>Party Name / Code</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                  Loading parties...
                </TableCell>
              </TableRow>
            ) : !displayParties || displayParties.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center">
                    <Building2 className="w-8 h-8 text-slate-300 mb-2" />
                    <p>No parties found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              displayParties.map((party) => (
                <TableRow key={party.id} className="hover:bg-slate-50">
                  <TableCell>
                    <div className="font-medium text-slate-900">{party.name}</div>
                    <div className="text-xs text-slate-500">Code: {party.code}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{party.contact_person || "—"}</div>
                    <div className="flex flex-col gap-1 mt-1 text-xs text-slate-500">
                      {party.email && (
                        <div className="flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {party.email}
                        </div>
                      )}
                      {party.phone && (
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {party.phone}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={party.status === "Active" ? "default" : "secondary"}>
                      {party.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {party.created_at ? format(new Date(party.created_at), "MMM d, yyyy") : "—"}
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
                        <DropdownMenuItem onClick={() => setSelectedPartyForView(party)}>
                          <Eye className="mr-2 h-4 w-4" /> View
                        </DropdownMenuItem>
                        {(isSuperAdmin || isCompanyAdmin || can("manage_parties")) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setSelectedPartyForEdit(party)}>
                              <Edit className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className={party.status === "Active" ? "text-amber-600" : "text-emerald-600"}
                              onClick={() => handleArchiveToggle(party)}
                            >
                              <Archive className="mr-2 h-4 w-4" /> 
                              {party.status === "Active" ? "Archive (Deactivate)" : "Activate"}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
