import { createFileRoute, useNavigate } from "@/vault/router-adapter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listParties, listParts, findDocumentByNumber, createPart, createDocument, updateDocument, createVersion, supersedeOlderVersions, logAudit, createNotification } from "@/vault/lib/api";
import { useAuth } from "@/vault/hooks/use-auth";
import { GoogleDriveService } from "@/vault/services/google-drive";
import { Button } from "@/vault/components/ui/button";
import { Input } from "@/vault/components/ui/input";
import { Label } from "@/vault/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/vault/components/ui/select";
import { Textarea } from "@/vault/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/vault/components/ui/card";
import { Badge } from "@/vault/components/ui/badge";
import { Check, ChevronRight, UploadCloud, File as FileIcon, AlertCircle } from "lucide-react";
import { DOC_STATUSES, DOCUMENT_TYPES, ALLOWED_EXTENSIONS, MAX_FILE_SIZE, formatBytes, DocStatus } from "@/vault/lib/rbac";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/upload")({
  component: UploadWizardPage,
});

const STEPS = [
  "Company",
  "Part",
  "Details",
  "File",
  "Version Check",
  "Review & Upload"
];

function UploadWizardPage() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

  // Form State
  const [partyId, setPartyId] = useState<string>("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("root");
  const [partId, setPartId] = useState<string>("");
  const [isNewPart, setIsNewPart] = useState(false);
  
  const [docNumber, setDocNumber] = useState("");
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState<string>("");
  const [drawingNumber, setDrawingNumber] = useState("");
  
  const [file, setFile] = useState<File | null>(null);
  
  const [existingDoc, setExistingDoc] = useState<any>(null);
  const [checkingDoc, setCheckingDoc] = useState(false);
  
  const [revisionNotes, setRevisionNotes] = useState("");
  const [status, setStatus] = useState<string>("Draft");
  
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [newDocId, setNewDocId] = useState<string | null>(null);

  // Queries
  const { data: parties, isLoading: partiesLoading } = useQuery({
    queryKey: ["parties-list"],
    queryFn: listParties,
  });

  const { data: parts, isLoading: partsLoading } = useQuery({
    queryKey: ["parts-list", partyId],
    queryFn: () => listParts(partyId),
    enabled: !!partyId && !isNewPart,
  });

  const { data: partyFolders } = useQuery({
    queryKey: ["drive_folders", partyId],
    queryFn: () => GoogleDriveService.listFolders(partyId),
    enabled: !!partyId && partyId !== "internal",
  });

  const handleNext = async () => {
    // Validation before next step
    if (currentStep === 0 && !partyId) {
      toast.error("Please select a party.");
      return;
    }
    if (currentStep === 1) {
      if (!isNewPart && !partId) {
        toast.error("Please select an existing part or create a new one.");
        return;
      }
    }
    if (currentStep === 2) {
      if (!docNumber || !docName || !docType) {
        toast.error("Please fill in all required document details.");
        return;
      }
    }
    if (currentStep === 3) {
      if (!file) {
        toast.error("Please select a file to upload.");
        return;
      }
      // Step 3 -> 4: Check if document exists
      setCheckingDoc(true);
      try {
        const doc = await findDocumentByNumber(docNumber);
        setExistingDoc(doc);
      } catch (e) {
        setExistingDoc(null);
      } finally {
        setCheckingDoc(false);
      }
    }

    if (currentStep < STEPS.length - 1) {
      setCurrentStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(s => s - 1);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    
    const ext = selected.name.split('.').pop()?.toLowerCase() as any;
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast.error(`Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`);
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      toast.error(`File too large. Max size is ${formatBytes(MAX_FILE_SIZE)}`);
      return;
    }
    setFile(selected);
  };

  const { session, profile } = useAuth();
  const userName = profile?.full_name || session?.user.email || "Unknown";
  const userId = session?.user.id;

  const handleUpload = async () => {
    setUploading(true);
    setUploadProgress(10);
    
    const interval = setInterval(() => {
      setUploadProgress(p => {
        if (p >= 90) {
          clearInterval(interval);
          return 90;
        }
        return p + 10;
      });
    }, 500);

    try {
      if (!file || !userId) throw new Error("Missing file or user session.");
      
      // Validation
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !ALLOWED_EXTENSIONS.includes(ext as any)) {
        throw new Error(`Unsupported file type: ${ext}`);
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("File exceeds maximum allowed size.");
      }
      
      const nextVersion = existingDoc ? existingDoc.current_version + 1 : 1;
      
      // Determine Party Name for Drive folder structure
      let partyName = "Internal";
      if (partyId !== "internal") {
        const party = parties?.find(p => p.id === partyId);
        if (party) partyName = party.name;
      }

      // 1. Google Drive Upload (MUST HAPPEN FIRST)
      const driveConfig = await GoogleDriveService.checkConfigurationStatus(partyId);
      if (!driveConfig.isConnected) {
        throw new Error("Google Drive is not connected. Upload aborted.");
      }
      
      let driveUpload;
      try {
        driveUpload = await GoogleDriveService.uploadFile(file, {
          partyId,
          documentNumber: docNumber,
          version: nextVersion,
          targetFolderId: selectedFolderId === 'root' ? undefined : selectedFolderId
        });
      } catch (err: any) {
        throw new Error(`Google Drive Upload Failed: ${err.message}. Database was not updated.`);
      }

      const googleDriveFileId = driveUpload.fileId;
      const googleDriveFolderId = driveUpload.folderId;

      // 2. Part handling (part number auto-generated internally; no user input)
      const autoNewPartNumber = docName.trim() || drawingNumber.trim() || `PRT-${Date.now().toString().slice(-6)}`;
      let finalPartId = partId;
      if (isNewPart) {
        const newPart = await createPart({
          party_id: partyId,
          part_number: autoNewPartNumber,
          part_name: docName,
        });
        finalPartId = newPart.id;
      }

      // 3. Document handling
      let finalDocId = existingDoc?.id;
      if (existingDoc) {
        await updateDocument(existingDoc.id, {
          document_name: docName,
          drawing_number: drawingNumber,
          document_type: docType,
          current_version: nextVersion,
          status: status as DocStatus,
          updated_by: userId,
          updated_by_name: userName,
          drive_folder_id: selectedFolderId === 'root' ? null : selectedFolderId,
        });
      } else {
        const newDoc = await createDocument({
          party_id: partyId === "internal" ? undefined : partyId, // Use null/undefined if internal depending on schema
          part_id: finalPartId || null,
          document_number: docNumber,
          document_name: docName,
          drawing_number: drawingNumber,
          part_number: isNewPart ? autoNewPartNumber : parts?.find(p => p.id === partId)?.part_number,
          document_type: docType,
          current_version: 1,
          status: status as DocStatus,
          file_type: ext,
          created_by: userId,
          created_by_name: userName,
          updated_by: userId,
          updated_by_name: userName,
          drive_folder_id: selectedFolderId === 'root' ? null : selectedFolderId,
        });
        finalDocId = newDoc.id;
      }

      // 4. Version handling
      await createVersion({
        document_id: finalDocId,
        version_number: nextVersion,
        file_name: file.name,
        file_type: ext,
        file_size: file.size,
        google_drive_file_id: googleDriveFileId,
        status: status as DocStatus,
        revision_notes: revisionNotes || "Initial upload",
        uploaded_by: userId,
        uploaded_by_name: userName,
      });

      // Supersede older versions
      if (nextVersion > 1) {
        await supersedeOlderVersions(finalDocId, nextVersion);
      }

      // 5. Audit log
      await logAudit({
        user_id: userId,
        user_name: userName,
        action: existingDoc ? "NEW_VERSION" : "UPLOAD",
        document_id: finalDocId,
        document_number: docNumber,
        version_number: nextVersion,
        details: `Uploaded V${nextVersion} to Drive (${googleDriveFileId}). Notes: ${revisionNotes}`,
      });

      await logAudit({
        user_id: userId,
        user_name: userName,
        action: "DRIVE_UPLOAD",
        document_id: finalDocId,
        document_number: docNumber,
        version_number: nextVersion,
        details: `File physically stored in Drive ID: ${googleDriveFileId}`,
      });

      // 6. Notification
      await createNotification({
        user_id: userId,
        title: existingDoc ? "New Version Uploaded" : "New Document Uploaded",
        body: `${docNumber} V${nextVersion} was uploaded successfully.`,
        type: "NEW_VERSION",
        document_id: finalDocId,
      });

      clearInterval(interval);
      setUploadProgress(100);
      setUploadComplete(true);
      setNewDocId(finalDocId);
    } catch (e: any) {
      clearInterval(interval);
      // Log drive failure
      await logAudit({
        user_id: userId,
        user_name: userName,
        action: "DRIVE_UPLOAD_FAILED",
        document_number: docNumber,
        details: e.message || "Failed to upload document",
      });
      toast.error(e.message || "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  if (uploadComplete) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-6">
        <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
          <Check className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900">Upload Successful</h2>
        <p className="text-slate-500">
          The document has been securely uploaded to CNC Vault. Version control, audit logs, and notifications have been automatically updated.
        </p>
        <div className="pt-6 flex justify-center gap-4">
          <Button variant="outline" onClick={() => navigate({ to: "/dashboard" })}>
            Go to Dashboard
          </Button>
          <Button onClick={() => navigate({ to: "/documents" })} className="bg-indigo-600 hover:bg-indigo-700">
            View Documents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Upload Document</h2>
        <p className="text-muted-foreground mt-1">
          Add new documents or update revisions of existing ones.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-between mb-8 overflow-x-auto pb-4">
        {STEPS.map((step, index) => (
          <div key={step} className="flex flex-col items-center min-w-[80px] relative">
            <div 
              className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm z-10 
                ${index < currentStep ? 'bg-indigo-600 text-white' : index === currentStep ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' : 'bg-slate-200 text-slate-500'}`}
            >
              {index < currentStep ? <Check className="w-4 h-4" /> : index + 1}
            </div>
            <span className={`text-xs mt-2 font-medium ${index <= currentStep ? 'text-slate-900' : 'text-slate-500'}`}>
              {step}
            </span>
            {index < STEPS.length - 1 && (
              <div className={`absolute top-4 left-[50%] w-full h-[2px] -z-0 
                ${index < currentStep ? 'bg-indigo-600' : 'bg-slate-200'}`} 
              />
            )}
          </div>
        ))}
      </div>

      <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle>{STEPS[currentStep]}</CardTitle>
          <CardDescription>
            {currentStep === 0 && "Select the company or department this document belongs to."}
            {currentStep === 1 && "Link this document to a specific engineering part."}
            {currentStep === 2 && "Enter the metadata for this document."}
            {currentStep === 3 && "Select the file to upload."}
            {currentStep === 4 && "Checking if this document already exists to create a new revision."}
            {currentStep === 5 && "Review details and confirm upload."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          
          {/* STEP 0: Party & Target Folder */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Select Company</Label>
                <Select value={partyId} onValueChange={(val) => { setPartyId(val); setSelectedFolderId("root"); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a company..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal / CNC Vault</SelectItem>
                    {parties?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {partyId && partyId !== "internal" && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <Label>Select Target Google Drive Folder</Label>
                  <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select target folder..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="root">📁 CNC Vault (Root Folder)</SelectItem>
                      {partyFolders?.map(f => (
                        <SelectItem key={f.id} value={f.google_folder_id}>
                          📁 {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    The document will be stored inside this folder in the company's Google Drive.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 1: Part */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex gap-4">
                <Button 
                  type="button" 
                  variant={!isNewPart ? "default" : "outline"}
                  onClick={() => setIsNewPart(false)}
                  className="flex-1"
                >
                  Select Existing Part
                </Button>
                <Button 
                  type="button" 
                  variant={isNewPart ? "default" : "outline"}
                  onClick={() => setIsNewPart(true)}
                  className="flex-1"
                >
                  Create New Part
                </Button>
              </div>

              {!isNewPart ? (
                <div className="space-y-2">
                  <Label>Existing Part</Label>
                  <Select value={partId} onValueChange={setPartId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a part..." />
                    </SelectTrigger>
                    <SelectContent>
                      {parts?.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.part_name || 'Unnamed product'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(!parts || parts.length === 0) && (
                    <p className="text-sm text-amber-600 mt-2">No parts found for this party. Please create a new one.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">
                    A new product will be created automatically using the document name. No product code entry is needed.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Details */}
          {currentStep === 2 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Document Number <span className="text-red-500">*</span></Label>
                <Input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="DOC-001" />
              </div>
              <div className="space-y-2">
                <Label>Document Name <span className="text-red-500">*</span></Label>
                <Input value={docName} onChange={e => setDocName(e.target.value)} placeholder="Assembly Instructions" />
              </div>
              <div className="space-y-2">
                <Label>Document Type <span className="text-red-500">*</span></Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Drawing Number</Label>
                <Input value={drawingNumber} onChange={e => setDrawingNumber(e.target.value)} placeholder="Optional" />
              </div>
            </div>
          )}

          {/* STEP 3: File */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center hover:bg-slate-50 transition-colors">
                <input 
                  type="file" 
                  id="file-upload" 
                  className="hidden" 
                  onChange={handleFileChange}
                />
                <Label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                  <UploadCloud className="w-12 h-12 text-indigo-500 mb-4" />
                  <span className="text-lg font-medium text-slate-900">Click to select file</span>
                  <span className="text-sm text-slate-500 mt-1">Supported: PDF, DWG, DXF, STEP, ZIP, NC, etc.</span>
                </Label>
              </div>
              {file && (
                <div className="flex items-center gap-3 bg-indigo-50 text-indigo-900 p-3 rounded-md border border-indigo-100">
                  <FileIcon className="w-5 h-5 text-indigo-600" />
                  <div className="flex-1 truncate">
                    <div className="font-medium text-sm truncate">{file.name}</div>
                    <div className="text-xs text-indigo-600/70">{formatBytes(file.size)}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setFile(null)} className="h-8 w-8 p-0 text-indigo-600">
                    ✕
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Version Check */}
          {currentStep === 4 && (
            <div className="space-y-6 text-center py-8">
              {checkingDoc ? (
                <div className="text-slate-500">Checking registry...</div>
              ) : existingDoc ? (
                <div className="space-y-4">
                  <div className="mx-auto w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
                    <AlertCircle className="w-6 h-6 text-amber-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900">Existing Document Found</h3>
                  <p className="text-slate-600">
                    Document <strong>{existingDoc.document_number}</strong> already exists in the vault.
                  </p>
                  <div className="flex items-center justify-center gap-4 mt-4 text-sm font-medium">
                    <Badge variant="outline" className="text-slate-500">Current: V{existingDoc.current_version}</Badge>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                    <Badge className="bg-amber-500 hover:bg-amber-600">New Version: V{existingDoc.current_version + 1}</Badge>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <Check className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900">New Document</h3>
                  <p className="text-slate-600">
                    No existing document found. This will be created as <strong>Version 1</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 5: Review & Upload */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <span className="text-slate-500">Document</span>
                  <div className="font-medium">{docNumber} - {docName}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500">Type</span>
                  <div className="font-medium">{docType}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500">File</span>
                  <div className="font-medium">{file?.name}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-500">Version Action</span>
                  <div className="font-medium">
                    {existingDoc ? `Create V${existingDoc.current_version + 1}` : "Create V1"}
                  </div>
                </div>
              </div>
              
              <div className="space-y-2 pt-4 border-t border-slate-100">
                <Label>Revision Notes (Required for new versions)</Label>
                <Textarea 
                  value={revisionNotes} 
                  onChange={e => setRevisionNotes(e.target.value)}
                  placeholder="e.g. Updated hole tolerances on flange."
                  className="h-20"
                />
              </div>

              <div className="space-y-2">
                <Label>Initial Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOC_STATUSES.filter(s => !['Superseded', 'Archived'].includes(s)).map(s => 
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Progress bar when uploading */}
              {uploading && (
                <div className="space-y-2 pt-4">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-600 transition-all duration-300 ease-in-out" 
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

        </CardContent>
        <CardFooter className="flex justify-between border-t border-slate-100 bg-slate-50/50 p-6 rounded-b-lg">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 0 || uploading}>
            Back
          </Button>
          {currentStep < STEPS.length - 1 ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button 
              onClick={handleUpload} 
              disabled={uploading || (existingDoc && !revisionNotes)} 
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {uploading ? "Processing..." : "Confirm & Upload"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
