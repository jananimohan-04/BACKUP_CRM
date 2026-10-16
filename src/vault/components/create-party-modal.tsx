import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createParty, Party } from "@/vault/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/vault/components/ui/dialog";
import { Button } from "@/vault/components/ui/button";
import { Input } from "@/vault/components/ui/input";
import { Label } from "@/vault/components/ui/label";
import { Building2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

interface CreatePartyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPartyCreated?: (party: Party) => void;
}

export function CreatePartyModal({ open, onOpenChange, onPartyCreated }: CreatePartyModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !code.trim()) {
        throw new Error("Company Name and Code are required.");
      }
      return await createParty({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        contact_person: contactPerson.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        status: "Active",
      });
    },
    onSuccess: (newParty) => {
      toast.success(`Company "${newParty.name}" created successfully!`);
      queryClient.invalidateQueries({ queryKey: ["parties-list"] });
      if (onPartyCreated) {
        onPartyCreated(newParty);
      }
      // Reset form
      setName("");
      setCode("");
      setContactPerson("");
      setEmail("");
      setPhone("");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to create company");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-900">
            <Building2 className="w-5 h-5 text-indigo-600" />
            Create New Company
          </DialogTitle>
          <DialogDescription>
            Add a new client company, supplier, or internal partner.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Company Name *</Label>
              <Input
                placeholder="e.g. ABC Engineering"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!code && e.target.value.length >= 3) {
                    setCode(e.target.value.slice(0, 3).toUpperCase());
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Code *</Label>
              <Input
                placeholder="e.g. ABC"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={10}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Contact Person</Label>
            <Input
              placeholder="e.g. John Smith"
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="contact@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                placeholder="+1 555-0199"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-indigo-600 hover:bg-indigo-700"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim() || !code.trim()}
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Save Company
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
